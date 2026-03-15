// ========================================
//  Mindset Stack — Firebase Sync
//  Handles auth UI + cloud data sync
// ========================================

(function () {
  'use strict';

  /* ------------------------------------------------
     Skip everything if Firebase isn't configured
  ------------------------------------------------ */
  if (
    typeof firebaseConfig === 'undefined' ||
    !firebaseConfig.apiKey ||
    firebaseConfig.apiKey === 'YOUR_API_KEY'
  ) {
    console.log('[sync] Firebase not configured — local-only mode');
    const el = document.getElementById('profile-auth');
    if (el) el.innerHTML = '<div class="profile-sync-status">Local only — no cloud sync</div>';
    return;
  }

  /* ---- Init Firebase ---- */
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // Offline cache (nice-to-have, not critical)
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  let currentUser = null;
  let syncTimer   = null;
  const SYNC_DELAY = 1500; // debounce cloud writes

  window.firebaseUser = null;

  /* ================================================
     AUTH UI — renders inside the Profile panel
  ================================================ */
  function renderAuthUI() {
    const el = document.getElementById('profile-auth');
    if (!el) return;

    if (currentUser) {
      el.innerHTML = `
        <div class="profile-sync-status"><span class="synced">&#10003; Synced</span></div>
        <button class="profile-auth-btn signout" id="profile-signout">Sign out</button>`;
      document.getElementById('profile-signout').addEventListener('click', () => auth.signOut());
    } else {
      el.innerHTML = `
        <div class="profile-sync-status">Sign in to sync across devices</div>
        <button class="profile-auth-btn signin" id="profile-signin">Sign in with Google</button>`;
      document.getElementById('profile-signin').addEventListener('click', doSignIn);
    }
  }

  function doSignIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider).catch(err => {
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
        // Fallback to redirect for mobile / popup-blocked browsers
        auth.signInWithRedirect(provider);
      } else {
        console.error('[auth] sign-in error:', err.message);
      }
    });
  }

  // Handle redirect result when page loads back from Google
  auth.getRedirectResult().catch(err => {
    if (err.code && err.code !== 'auth/null') {
      console.error('[auth] redirect error:', err.message);
    }
  });

  /* ================================================
     CLOUD SYNC
  ================================================ */

  function pushToCloud() {
    if (!currentUser) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        await db.collection('users').doc(currentUser.uid).set({
          habitDefs:   state.habitDefs,
          currentWeek: state.currentWeek,
          weeks:       state.weeks,
          profile:     state.profile || {},
          achievements: state.achievements || [],
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('[sync] pushed to cloud');
      } catch (e) {
        console.error('[sync] push failed:', e.message);
      }
    }, SYNC_DELAY);
  }

  async function pullFromCloud() {
    if (!currentUser) return null;
    try {
      const snap = await db.collection('users').doc(currentUser.uid).get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      console.error('[sync] pull failed:', e.message);
      return null;
    }
  }

  /* ------------------------------------------------
     On sign-in: merge data + fill profile from Google
  ------------------------------------------------ */
  async function onSignIn(user) {
    currentUser = user;
    window.firebaseUser = user;
    renderAuthUI();

    // Detect account switch — clear local data if different user
    const lastUid = localStorage.getItem('mindset_lastUid');
    if (lastUid && lastUid !== user.uid) {
      console.log('[sync] account switched — clearing local state');
      state.habitDefs = [];
      state.weeks = {};
      state.currentWeek = getCurrentMonday();
      state.profile = {};
    }
    localStorage.setItem('mindset_lastUid', user.uid);

    // Always fill profile from Google account
    if (!state.profile) state.profile = {};
    const parts = (user.displayName || '').split(' ');
    state.profile.firstName = parts[0] || state.profile.firstName || '';
    state.profile.lastName  = parts.slice(1).join(' ') || state.profile.lastName || '';
    state.profile.email     = user.email || state.profile.email || '';
    state.profile.photoURL  = user.photoURL || state.profile.photoURL || '';
    saveStateLocal();
    if (typeof updateProfileButton === 'function') updateProfileButton();
    if (typeof renderDashboard === 'function') renderDashboard();

    // Sync with cloud
    const cloud    = await pullFromCloud();
    const hasCloud = cloud && Array.isArray(cloud.habitDefs) && cloud.habitDefs.length > 0;
    const hasLocal = state.habitDefs.length > 0;

    if (hasCloud) {
      state.habitDefs   = cloud.habitDefs;
      state.currentWeek = cloud.currentWeek || getCurrentMonday();
      state.weeks       = cloud.weeks || {};
      if (cloud.profile) state.profile = cloud.profile;
      if (cloud.achievements) state.achievements = cloud.achievements;
      saveStateLocal();
      viewingDate = new Date();
      renderAll();
      console.log('[sync] loaded cloud data');
    } else if (hasLocal) {
      pushToCloud();
      console.log('[sync] uploaded local data to cloud');
    }

    // Always re-apply Google Auth profile (authoritative source)
    const nameParts = (user.displayName || '').split(' ');
    state.profile.firstName = nameParts[0] || state.profile.firstName || '';
    state.profile.lastName  = nameParts.slice(1).join(' ') || state.profile.lastName || '';
    state.profile.email     = user.email || state.profile.email || '';
    state.profile.photoURL  = user.photoURL || '';
    saveStateLocal();
    if (typeof updateProfileButton === 'function') updateProfileButton();
    if (typeof renderDashboard === 'function') renderDashboard();

    // Sync public profile + load social data
    syncUserProfile();
    loadFollowingSet();

    // Start notification listener
    if (typeof window._notifUnsubscribe === 'function') window._notifUnsubscribe();
    window._notifUnsubscribe = listenNotifications(notifs => {
      if (typeof window.onNotifsUpdate === 'function') window.onNotifsUpdate(notifs);
    });

    // Welcome notification on first-ever sign-in
    if (!lastUid) {
      sendWelcomeNotification().catch(e => console.error('[notif] welcome failed:', e.message));
    }

    if (typeof window.onAuthReady === 'function') window.onAuthReady(true);
  }

  function onSignOut() {
    currentUser = null;
    window.firebaseUser = null;
    clearTimeout(syncTimer);
    renderAuthUI();
    // Unsubscribe from notification listener
    if (typeof window._notifUnsubscribe === 'function') {
      window._notifUnsubscribe();
      window._notifUnsubscribe = null;
    }
    // Close any open overlays
    const dashOverlay = document.getElementById('dashboard-overlay');
    if (dashOverlay) dashOverlay.classList.remove('visible');
    const userViewOverlay = document.getElementById('user-view-overlay');
    if (userViewOverlay) userViewOverlay.classList.remove('visible');
    const notifOverlay = document.getElementById('notif-overlay');
    if (notifOverlay) notifOverlay.classList.remove('visible');
    if (typeof window.onAuthReady === 'function') window.onAuthReady(false);
  }

  /* ================================================
     SOCIAL — User Profiles, Search, Follow
  ================================================ */

  function generateSearchTerms(profile) {
    const terms = new Set();
    const emailUser = profile.email ? profile.email.split('@')[0] : '';
    // Split email username by dots to index each part (e.g. "v.wazapovich" → "v", "wazapovich")
    const emailParts = emailUser.split('.').filter(p => p.length > 0);
    const sources = [
      profile.firstName || '',
      profile.lastName || '',
      emailUser,
      ...emailParts,
      ((profile.firstName || '') + ' ' + (profile.lastName || '')).trim()
    ];
    sources.forEach(src => {
      const lower = src.toLowerCase().trim();
      if (!lower) return;
      terms.add(lower);
      for (let i = 2; i <= lower.length && i <= 15; i++) {
        terms.add(lower.substring(0, i));
      }
    });
    return Array.from(terms);
  }

  async function syncUserProfile() {
    if (!currentUser) return;
    const p = state.profile || {};
    try {
      await db.collection('userProfiles').doc(currentUser.uid).set({
        uid: currentUser.uid,
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        email: p.email || '',
        photoURL: p.photoURL || '',
        nickname: p.nickname || '',
        country: p.country || '',
        dob: p.dob || '',
        displayName: ((p.firstName || '') + ' ' + (p.lastName || '')).trim(),
        searchTerms: generateSearchTerms(p),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error('[social] profile sync failed:', e.message);
    }
  }

  async function searchUsers(query) {
    if (!currentUser || !query) return [];
    const term = query.toLowerCase().trim();
    if (term.length < 2) return [];
    try {
      // Try prefix search first
      let snap = await db.collection('userProfiles')
        .where('searchTerms', 'array-contains', term)
        .limit(20)
        .get();
      let results = snap.docs.map(d => d.data()).filter(u => u.uid !== currentUser.uid);

      // Fallback: exact email match
      if (results.length === 0 && term.includes('@')) {
        snap = await db.collection('userProfiles')
          .where('email', '==', term)
          .limit(1)
          .get();
        results = snap.docs.map(d => d.data()).filter(u => u.uid !== currentUser.uid);
      }
      return results;
    } catch (e) {
      console.error('[social] search failed:', e.message);
      return [];
    }
  }

  // ---- Follow / Unfollow ----

  let followingSet = new Set();

  async function followUser(targetUid, targetProfile) {
    if (!currentUser || targetUid === currentUser.uid) return;
    const p = state.profile || {};
    const myDisplay = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
    const targetDisplay = ((targetProfile.firstName || '') + ' ' + (targetProfile.lastName || '')).trim();

    const batch = db.batch();
    batch.set(db.collection('users').doc(currentUser.uid).collection('following').doc(targetUid), {
      uid: targetUid, displayName: targetDisplay, photoURL: targetProfile.photoURL || '',
      followedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.set(db.collection('users').doc(targetUid).collection('followers').doc(currentUser.uid), {
      uid: currentUser.uid, displayName: myDisplay, photoURL: p.photoURL || '',
      followedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    try {
      await batch.commit();
      followingSet.add(targetUid);
      console.log('[social] followed', targetUid);

      // Send new follower notification (non-blocking)
      createNotification(
        targetUid,
        'new_follower',
        'New Follower',
        `${myDisplay || 'Someone'} started following you`,
        {
          senderUid: currentUser.uid,
          senderName: myDisplay || 'Someone',
          senderPhotoURL: p.photoURL || ''
        }
      ).catch(e => console.error('[notif] follower notif failed:', e.message));
    } catch (e) {
      console.error('[social] follow failed:', e.message);
    }
  }

  async function unfollowUser(targetUid) {
    if (!currentUser) return;

    const batch = db.batch();
    batch.delete(db.collection('users').doc(currentUser.uid).collection('following').doc(targetUid));
    batch.delete(db.collection('users').doc(targetUid).collection('followers').doc(currentUser.uid));

    try {
      await batch.commit();
      followingSet.delete(targetUid);
      console.log('[social] unfollowed', targetUid);
    } catch (e) {
      console.error('[social] unfollow failed:', e.message);
    }
  }

  async function loadFollowingSet() {
    if (!currentUser) return;
    try {
      const snap = await db.collection('users').doc(currentUser.uid).collection('following').get();
      followingSet = new Set(snap.docs.map(d => d.id));
      window.followingSet = followingSet;
    } catch (e) {
      console.error('[social] load following failed:', e.message);
    }
  }

  async function loadFollowing(uid) {
    try {
      const snap = await db.collection('users').doc(uid).collection('following').get();
      return snap.docs.map(d => d.data());
    } catch (e) {
      console.error('[social] load following list failed:', e.message);
      return [];
    }
  }

  async function loadFollowers(uid) {
    try {
      const snap = await db.collection('users').doc(uid).collection('followers').get();
      return snap.docs.map(d => d.data());
    } catch (e) {
      console.error('[social] load followers list failed:', e.message);
      return [];
    }
  }

  async function getMyProfileCounts() {
    if (!currentUser) return { followersCount: 0, followingCount: 0 };
    try {
      const [followersSnap, followingSnap] = await Promise.all([
        db.collection('users').doc(currentUser.uid).collection('followers').get(),
        db.collection('users').doc(currentUser.uid).collection('following').get()
      ]);
      return {
        followersCount: followersSnap.size,
        followingCount: followingSnap.size
      };
    } catch (e) { /* ignore */ }
    return { followersCount: 0, followingCount: 0 };
  }

  // ---- View Other User's Data ----

  async function fetchUserView(targetUid) {
    if (!currentUser) return null;
    try {
      const [userSnap, profileSnap, followersSnap, followingSnap] = await Promise.all([
        db.collection('users').doc(targetUid).get(),
        db.collection('userProfiles').doc(targetUid).get(),
        db.collection('users').doc(targetUid).collection('followers').get(),
        db.collection('users').doc(targetUid).collection('following').get()
      ]);
      if (!userSnap.exists) return null;

      const userData = userSnap.data();
      const profileData = profileSnap.exists ? profileSnap.data() : {};
      const isFollowing = followingSet.has(targetUid);

      // Filter habits by privacy
      const visibleHabits = (userData.habitDefs || []).filter(h => {
        const prv = h.privacy || 'followers';
        if (prv === 'public') return true;
        if (prv === 'followers' && isFollowing) return true;
        return false;
      });
      const visibleIds = new Set(visibleHabits.map(h => h.id));

      // Filter week data
      const curWeek = userData.currentWeek || getCurrentMonday();
      const wd = userData.weeks ? userData.weeks[curWeek] : null;
      let filteredWeek = null;
      if (wd) {
        const filteredChecks = {};
        visibleHabits.forEach(h => {
          if (wd.habitChecks && wd.habitChecks[h.id]) filteredChecks[h.id] = wd.habitChecks[h.id];
        });
        const filteredDays = (wd.days || []).map(day => ({
          tasks: (day.tasks || []).filter(t => {
            const prv = t.privacy || 'followers';
            if (prv === 'public') return true;
            if (prv === 'followers' && isFollowing) return true;
            return false;
          })
        }));
        filteredWeek = { habitChecks: filteredChecks, days: filteredDays };
      }

      return {
        uid: targetUid,
        profile: profileData,
        habitDefs: visibleHabits,
        currentWeek: curWeek,
        weekData: filteredWeek,
        isFollowing,
        followersCount: followersSnap.size,
        followingCount: followingSnap.size
      };
    } catch (e) {
      console.error('[social] fetchUserView failed:', e.message);
      return null;
    }
  }

  function isFollowingUser(uid) {
    return followingSet.has(uid);
  }

  /* ================================================
     CHALLENGES
  ================================================ */

  function generateChallengeSearchTerms(title) {
    const terms = new Set();
    (title || '').toLowerCase().split(/\s+/).forEach(word => {
      if (!word) return;
      for (let i = 2; i <= Math.min(word.length, 15); i++) {
        terms.add(word.substring(0, i));
      }
    });
    return Array.from(terms);
  }

  async function createChallenge(formData) {
    if (!currentUser) return null;
    const p = state.profile || {};
    const displayName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
    const id = 'ch_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startD = new Date(formData.startDate + 'T00:00:00');
    const endD = new Date(formData.endDate + 'T00:00:00');
    const status = today < startD ? 'upcoming' : (today > endD ? 'completed' : 'active');

    const challengeDoc = {
      id,
      title: formData.title.trim(),
      description: (formData.description || '').trim(),
      creatorUid: currentUser.uid,
      creatorName: displayName,
      creatorPhotoURL: currentUser.photoURL || '',
      startDate: formData.startDate,
      endDate: formData.endDate,
      mode: formData.mode,
      visibility: formData.visibility,
      items: formData.items.map(item => ({
        id: item.id || ('ch_i_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4)),
        name: item.name.trim(),
        frequency: Math.max(1, Math.min(7, item.frequency || 7)),
        target: Math.max(0, item.target || 0),
        unit: item.unit || ''
      })),
      participantCount: 1,
      status,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const batch = db.batch();

    // 1. Challenge doc
    batch.set(db.collection('challenges').doc(id), challengeDoc);

    // 2. Challenge index (lightweight)
    batch.set(db.collection('challengeIndex').doc(id), {
      id,
      title: challengeDoc.title,
      creatorUid: currentUser.uid,
      creatorName: displayName,
      creatorPhotoURL: currentUser.photoURL || '',
      startDate: formData.startDate,
      endDate: formData.endDate,
      mode: formData.mode,
      visibility: formData.visibility,
      participantCount: 1,
      itemCount: challengeDoc.items.length,
      status,
      searchTerms: generateChallengeSearchTerms(formData.title),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 3. Creator as participant
    batch.set(
      db.collection('challenges').doc(id).collection('participants').doc(currentUser.uid),
      {
        uid: currentUser.uid,
        displayName,
        photoURL: currentUser.photoURL || '',
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        weeks: {}
      }
    );

    // 4. User's challenge membership
    batch.set(
      db.collection('users').doc(currentUser.uid).collection('challenges').doc(id),
      {
        challengeId: id,
        title: challengeDoc.title,
        startDate: formData.startDate,
        endDate: formData.endDate,
        mode: formData.mode,
        role: 'creator',
        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    );

    await batch.commit();
    console.log('[challenges] created:', id);

    // Send challenge invites (non-blocking)
    if (formData.invitedUids && formData.invitedUids.length > 0) {
      sendChallengeInvites(id, challengeDoc.title, formData.invitedUids)
        .catch(e => console.error('[notif] invite send failed:', e.message));
    }

    return id;
  }

  async function joinChallenge(challengeId) {
    if (!currentUser) return;
    const p = state.profile || {};
    const displayName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim();

    // Fetch challenge info for membership doc
    const chSnap = await db.collection('challenges').doc(challengeId).get();
    if (!chSnap.exists) throw new Error('Challenge not found');
    const ch = chSnap.data();

    const batch = db.batch();

    batch.set(
      db.collection('challenges').doc(challengeId).collection('participants').doc(currentUser.uid),
      {
        uid: currentUser.uid,
        displayName,
        photoURL: currentUser.photoURL || '',
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        weeks: {}
      }
    );

    batch.set(
      db.collection('users').doc(currentUser.uid).collection('challenges').doc(challengeId),
      {
        challengeId: ch.id,
        title: ch.title,
        startDate: ch.startDate,
        endDate: ch.endDate,
        mode: ch.mode,
        role: 'participant',
        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    );

    batch.update(db.collection('challenges').doc(challengeId), {
      participantCount: firebase.firestore.FieldValue.increment(1)
    });
    batch.update(db.collection('challengeIndex').doc(challengeId), {
      participantCount: firebase.firestore.FieldValue.increment(1)
    });

    await batch.commit();
    console.log('[challenges] joined:', challengeId);
  }

  async function leaveChallenge(challengeId) {
    if (!currentUser) return;
    const batch = db.batch();

    batch.delete(
      db.collection('challenges').doc(challengeId).collection('participants').doc(currentUser.uid)
    );
    batch.delete(
      db.collection('users').doc(currentUser.uid).collection('challenges').doc(challengeId)
    );
    batch.update(db.collection('challenges').doc(challengeId), {
      participantCount: firebase.firestore.FieldValue.increment(-1)
    });
    batch.update(db.collection('challengeIndex').doc(challengeId), {
      participantCount: firebase.firestore.FieldValue.increment(-1)
    });

    await batch.commit();
    console.log('[challenges] left:', challengeId);
  }

  async function deleteChallenge(challengeId) {
    if (!currentUser) return;

    // Verify creator ownership
    const challengeSnap = await db.collection('challenges').doc(challengeId).get();
    if (!challengeSnap.exists) throw new Error('Challenge not found');
    if (challengeSnap.data().creatorUid !== currentUser.uid) throw new Error('Only the creator can delete');

    // Load all participants to clean up their membership docs
    const participantsSnap = await db.collection('challenges').doc(challengeId)
      .collection('participants').get();

    const batch = db.batch();

    // Delete each participant doc and their user membership
    participantsSnap.docs.forEach(pDoc => {
      batch.delete(pDoc.ref);
      batch.delete(db.collection('users').doc(pDoc.id).collection('challenges').doc(challengeId));
    });

    // Delete the challenge index doc
    batch.delete(db.collection('challengeIndex').doc(challengeId));

    // Delete the main challenge doc
    batch.delete(db.collection('challenges').doc(challengeId));

    await batch.commit();
    console.log('[challenges] deleted:', challengeId);
  }

  async function updateChallenge(challengeId, updates) {
    if (!currentUser) return;

    // Verify creator ownership
    const challengeSnap = await db.collection('challenges').doc(challengeId).get();
    if (!challengeSnap.exists) throw new Error('Challenge not found');
    if (challengeSnap.data().creatorUid !== currentUser.uid) throw new Error('Only the creator can edit');

    const batch = db.batch();

    const challengeRef = db.collection('challenges').doc(challengeId);
    const indexRef = db.collection('challengeIndex').doc(challengeId);

    const fields = {};
    if (updates.title !== undefined) fields.title = updates.title;
    if (updates.description !== undefined) fields.description = updates.description;
    if (updates.startDate !== undefined) fields.startDate = updates.startDate;
    if (updates.endDate !== undefined) fields.endDate = updates.endDate;
    if (updates.mode !== undefined) fields.mode = updates.mode;
    if (updates.visibility !== undefined) fields.visibility = updates.visibility;
    if (updates.items !== undefined) fields.items = updates.items;
    fields.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    // Recompute status
    if (fields.startDate || fields.endDate) {
      const start = fields.startDate || challengeSnap.data().startDate;
      const end = fields.endDate || challengeSnap.data().endDate;
      const today = new Date().toISOString().split('T')[0];
      fields.status = today < start ? 'upcoming' : today > end ? 'completed' : 'active';
    }

    batch.update(challengeRef, fields);

    // Update index — mirror key fields + regenerate search terms if title changed
    const indexFields = { ...fields };
    if (fields.title) {
      indexFields.searchTerms = generateChallengeSearchTerms(fields.title);
    }
    batch.update(indexRef, indexFields);

    await batch.commit();
    console.log('[challenges] updated:', challengeId);
  }

  async function loadMyChallenges() {
    if (!currentUser) return [];
    const snap = await db.collection('users').doc(currentUser.uid)
      .collection('challenges').get();
    return snap.docs.map(d => d.data());
  }

  async function browseChallenges(query) {
    let ref;
    if (query && query.length >= 2) {
      ref = db.collection('challengeIndex')
        .where('visibility', '==', 'public')
        .where('searchTerms', 'array-contains', query.toLowerCase().trim())
        .limit(20);
    } else {
      ref = db.collection('challengeIndex')
        .where('visibility', '==', 'public')
        .orderBy('createdAt', 'desc')
        .limit(20);
    }
    const snap = await ref.get();
    return snap.docs.map(d => d.data());
  }

  async function loadChallengeDetail(challengeId) {
    const [challengeSnap, participantsSnap] = await Promise.all([
      db.collection('challenges').doc(challengeId).get(),
      db.collection('challenges').doc(challengeId).collection('participants').get()
    ]);

    if (!challengeSnap.exists) return null;

    return {
      ...challengeSnap.data(),
      participants: participantsSnap.docs.map(d => d.data())
    };
  }

  async function updateChallengeCheck(challengeId, weekStart, itemId, dayIndex, value) {
    if (!currentUser) return;
    const ref = db.collection('challenges').doc(challengeId)
      .collection('participants').doc(currentUser.uid);

    // Read-modify-write for the specific week's checks
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : { weeks: {} };
    if (!data.weeks) data.weeks = {};
    if (!data.weeks[weekStart]) data.weeks[weekStart] = { checks: {} };
    if (!data.weeks[weekStart].checks) data.weeks[weekStart].checks = {};
    if (!data.weeks[weekStart].checks[itemId]) {
      data.weeks[weekStart].checks[itemId] = Array(7).fill(typeof value === 'boolean' ? false : 0);
    }
    data.weeks[weekStart].checks[itemId][dayIndex] = value;

    await ref.update({ [`weeks.${weekStart}.checks.${itemId}`]: data.weeks[weekStart].checks[itemId] });
    console.log('[challenges] updated check:', itemId, dayIndex, value);
  }

  /* ---- Listen for auth changes ---- */
  auth.onAuthStateChanged(user => {
    user ? onSignIn(user) : onSignOut();
  });

  /* ---- Auth gate sign-in button ---- */
  const gateBtn = document.getElementById('auth-gate-signin');
  if (gateBtn) gateBtn.addEventListener('click', doSignIn);

  /* ------------------------------------------------
     NOTIFICATIONS
     ------------------------------------------------ */

  function generateNotifId() {
    return 'notif_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  async function createNotification(targetUid, type, title, body, data) {
    const id = generateNotifId();
    await db.collection('users').doc(targetUid).collection('notifications').doc(id).set({
      id,
      type,
      title,
      body,
      data: data || {},
      read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return id;
  }

  async function sendWelcomeNotification() {
    if (!currentUser) return;
    await createNotification(
      currentUser.uid,
      'welcome',
      'Welcome to Mindset Stack!',
      'Congratulations on joining! Start tracking your habits and build momentum.',
      {}
    );
  }

  async function sendChallengeInvites(challengeId, challengeTitle, invitedUids) {
    if (!currentUser || !invitedUids || invitedUids.length === 0) return;
    const p = state.profile || {};
    const senderName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || 'Someone';
    const senderPhotoURL = p.photoURL || '';

    const writes = invitedUids.map(uid =>
      createNotification(
        uid,
        'challenge_invite',
        'Challenge Invitation',
        `${senderName} invited you to join "${challengeTitle}"`,
        {
          challengeId,
          challengeTitle,
          senderUid: currentUser.uid,
          senderName,
          senderPhotoURL
        }
      )
    );
    await Promise.all(writes);
  }

  async function loadNotifications() {
    if (!currentUser) return [];
    try {
      const snap = await db.collection('users').doc(currentUser.uid)
        .collection('notifications')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      return snap.docs.map(d => d.data());
    } catch (e) {
      console.error('[notif] load failed:', e.message);
      return [];
    }
  }

  function listenNotifications(callback) {
    if (!currentUser) return () => {};
    return db.collection('users').doc(currentUser.uid)
      .collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(snap => {
        const notifs = snap.docs.map(d => d.data());
        callback(notifs);
      }, e => console.error('[notif] listen failed:', e.message));
  }

  async function markNotificationRead(notifId) {
    if (!currentUser) return;
    try {
      await db.collection('users').doc(currentUser.uid)
        .collection('notifications').doc(notifId)
        .update({ read: true });
    } catch (e) {
      console.error('[notif] mark read failed:', e.message);
    }
  }

  async function markAllNotificationsRead() {
    if (!currentUser) return;
    try {
      const snap = await db.collection('users').doc(currentUser.uid)
        .collection('notifications')
        .where('read', '==', false)
        .get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach(d => batch.update(d.ref, { read: true }));
      await batch.commit();
    } catch (e) {
      console.error('[notif] mark all read failed:', e.message);
    }
  }

  async function deleteNotification(notifId) {
    if (!currentUser) return;
    try {
      await db.collection('users').doc(currentUser.uid)
        .collection('notifications').doc(notifId).delete();
    } catch (e) {
      console.error('[notif] delete failed:', e.message);
    }
  }

  async function addSuccessfulDayNotification() {
    if (!currentUser) return;
    // Deduplicate: only 1 per day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    try {
      const snap = await db.collection('users').doc(currentUser.uid)
        .collection('notifications')
        .where('type', '==', 'successful_day')
        .where('createdAt', '>=', todayStart)
        .limit(1)
        .get();
      if (!snap.empty) return;
    } catch (e) {
      // Index may not exist yet — proceed anyway
      console.warn('[notif] dedup check failed, sending anyway:', e.message);
    }
    await createNotification(
      currentUser.uid,
      'successful_day',
      'Perfect Day! 🌟',
      'You completed all your habits and tasks today!',
      {}
    );
  }

  async function addHabitReminderNotification() {
    if (!currentUser) return;
    await createNotification(
      currentUser.uid,
      'habit_reminder',
      'Daily Reminder',
      "Don't forget to complete your habits today!",
      {}
    );
  }

  /* ---- Expose hooks for app.js ---- */
  window.firebaseSync = pushToCloud;
  window.socialSync = {
    syncUserProfile,
    searchUsers,
    followUser,
    unfollowUser,
    loadFollowingSet,
    loadFollowing,
    loadFollowers,
    getMyProfileCounts,
    fetchUserView,
    isFollowingUser
  };
  window.challengeSync = {
    createChallenge,
    joinChallenge,
    leaveChallenge,
    deleteChallenge,
    updateChallenge,
    loadMyChallenges,
    browseChallenges,
    loadChallengeDetail,
    updateChallengeCheck
  };
  window.notifSync = {
    createNotification,
    sendWelcomeNotification,
    sendChallengeInvites,
    loadNotifications,
    listenNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    addSuccessfulDayNotification,
    addHabitReminderNotification
  };

})();
