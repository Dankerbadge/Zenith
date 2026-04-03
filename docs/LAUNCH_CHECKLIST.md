# Zenith Pre-Launch Checklist

## 📱 APP PREPARATION

### Code Quality
- [ ] Remove all console.log statements (replace with devLog)
- [ ] Remove all TODO comments
- [ ] Fix all TypeScript warnings
- [ ] Remove unused imports
- [ ] Remove commented-out code
- [ ] Run ESLint and fix all errors
- [ ] Optimize bundle size
- [ ] Test on release build (not just development)

### Error Handling
- [ ] Wrap app in ErrorBoundary component
- [ ] Add try-catch blocks to all async functions
- [ ] Test error scenarios (network failure, storage full)
- [ ] Verify graceful degradation for offline mode
- [ ] Test with airplane mode enabled
- [ ] Verify error messages are user-friendly

### Performance
- [ ] Test with 365 days of data
- [ ] Verify smooth scrolling on all screens
- [ ] Check for memory leaks
- [ ] Optimize image assets (compress, use WebP)
- [ ] Test app launch time (< 3 seconds)
- [ ] Verify no lag when logging workouts
- [ ] Test GPS performance on real device

### Data & Storage
- [ ] Test AsyncStorage with quota limits
- [ ] Verify data persistence after app restart
- [ ] Test data migration (if upgrading from previous version)
- [ ] Verify old data cleanup works (365+ days)
- [ ] Test with empty state (fresh install)
- [ ] Verify no data loss on background/foreground

---

## 🧪 TESTING

### Device Testing
- [ ] iPhone 14/15 (Latest iOS)
- [ ] iPhone SE (Small screen)
- [ ] iPad (Tablet layout - if supported)
- [ ] Android Pixel (Latest Android)
- [ ] Android Samsung (OneUI)
- [ ] Old device (iOS 15, Android 12)

### Feature Testing
- [ ] Complete onboarding flow (all 11 screens)
- [ ] Log all 6 workout types
- [ ] Log food for all 4 meals
- [ ] Log weight with all 6 stats visible
- [ ] Start and complete GPS run
- [ ] Unlock achievement
- [ ] Rank up
- [ ] View stats (all-time + weekly)
- [ ] Edit profile
- [ ] Change notification settings
- [ ] View exercise pack store
- [ ] Test subscription flow (sandbox mode)
- [ ] Test one-time pack purchase (sandbox mode)
- [ ] Access premium features with Pro
- [ ] Get blocked by premium gate without Pro

### Integration Testing
- [ ] Apple Health permissions
- [ ] Heart rate data reading
- [ ] HRV data reading
- [ ] Sleep data reading
- [ ] Step count reading
- [ ] GPS location permissions
- [ ] Notification permissions
- [ ] Background location (iOS)

### Edge Cases
- [ ] First-time user with no data
- [ ] User with 1 year of data
- [ ] Switching accounts
- [ ] Logging out and back in
- [ ] Deleting account
- [ ] Subscription expiry
- [ ] Trial expiry
- [ ] App killed during GPS run
- [ ] Low battery during run
- [ ] Network loss during sync

### Subscription Testing (Sandbox)
- [ ] Start free trial
- [ ] Cancel during trial
- [ ] Convert trial to paid
- [ ] Monthly subscription
- [ ] Yearly subscription
- [ ] Subscription renewal
- [ ] Restore purchases
- [ ] Subscription cancellation
- [ ] Access after cancellation (until period ends)
- [ ] Re-subscribe after cancellation

---

## 📄 LEGAL & COMPLIANCE

### Documents
- [ ] Privacy Policy published at /privacy URL
- [ ] Terms of Service published at /terms URL
- [ ] Support page published at /support URL
- [ ] Privacy Policy linked in app Settings
- [ ] Terms linked in app Settings
- [ ] Privacy Policy URL in App Store Connect
- [ ] Terms URL in App Store Connect

### App Store Guidelines
- [ ] No crashes on launch
- [ ] No placeholder content
- [ ] No Lorem Ipsum text
- [ ] All features functional
- [ ] No broken links
- [ ] In-app purchases work in sandbox
- [ ] Subscription auto-renewal disclosure
- [ ] Free trial terms clearly stated
- [ ] Restore purchases button present
- [ ] Age rating accurate (4+)
- [ ] Content appropriate for age rating

### Health & Fitness Compliance
- [ ] Medical disclaimer in app
- [ ] No medical claims
- [ ] No diagnosis features
- [ ] Clear "consult doctor" messaging
- [ ] Apple Health data properly disclosed
- [ ] Health data permissions explained
- [ ] Health data stored securely

### Privacy Compliance
- [ ] GDPR compliant (if targeting EU)
- [ ] CCPA compliant (California users)
- [ ] Data deletion option available
- [ ] Data export option available (Pro)
- [ ] Privacy manifest file (iOS 17+)
- [ ] Permission requests explained
- [ ] No tracking without consent

---

## 🎨 APP STORE ASSETS

### Screenshots (Required)
- [ ] 6.7" iPhone (1290x2796) - 3 screenshots minimum
- [ ] 6.5" iPhone (1242x2688) - 3 screenshots minimum
- [ ] 5.5" iPhone (1242x2208) - 3 screenshots minimum
- [ ] iPad Pro 12.9" (2048x2732) - if supporting iPad
- [ ] Android screenshots for Play Store

**Screenshot Requirements:**
- [ ] No device frames needed
- [ ] No status bar (home indicator OK)
- [ ] Actual app UI (no mockups)
- [ ] Titles and captions added
- [ ] High quality (no pixelation)
- [ ] Represent actual features

### App Icon
- [ ] 1024x1024 PNG (no transparency)
- [ ] Looks good at small sizes
- [ ] No text (icon only)
- [ ] Recognizable brand
- [ ] Tested on all backgrounds

### App Preview Video (Optional but Recommended)
- [ ] 15-30 seconds
- [ ] Portrait orientation
- [ ] Shows key features
- [ ] No audio required
- [ ] Captions for clarity
- [ ] Ends with CTA

### Text Assets
- [ ] App name (Zenith: Fitness Tracker & Gym)
- [ ] Subtitle (30 chars)
- [ ] Description (4000 chars)
- [ ] Keywords (100 chars)
- [ ] What's New (4000 chars)
- [ ] Promotional text (170 chars)
- [ ] Support URL
- [ ] Marketing URL
- [ ] Privacy URL

---

## 🔐 APP STORE CONNECT SETUP

### App Information
- [ ] Bundle ID created (com.yourcompany.zenith)
- [ ] App name available
- [ ] Primary category: Health & Fitness
- [ ] Secondary category: Lifestyle
- [ ] Age rating: 4+
- [ ] Copyright: © 2026 Your Company Name
- [ ] Support URL configured
- [ ] Marketing URL configured
- [ ] Privacy URL configured

### Pricing & Availability
- [ ] Countries selected (or worldwide)
- [ ] Price tier: Free (with IAP)
- [ ] Release date selected
- [ ] Automatic release enabled/disabled

### In-App Purchases Setup
- [ ] Zenith Pro Monthly ($6.99) - Auto-renewable
- [ ] Zenith Pro Yearly ($49.99) - Auto-renewable
- [ ] Lifting Pack ($4.99) - Non-consumable
- [ ] Running Pack ($4.99) - Non-consumable
- [ ] Calisthenics Pack ($4.99) - Non-consumable
- [ ] Free trial configured (7 days)
- [ ] Subscription group created
- [ ] Pricing tiers set
- [ ] Descriptions written
- [ ] Screenshots for IAP (if needed)

### Build Upload
- [ ] Archive created in Xcode
- [ ] Build uploaded to App Store Connect
- [ ] Build processing complete
- [ ] Build selected for submission
- [ ] TestFlight testing complete
- [ ] Export compliance answered
- [ ] Encryption disclosure (if applicable)

---

## 🧑‍💻 TESTFLIGHT

### Beta Testing
- [ ] Internal testing group created
- [ ] 5-10 internal testers invited
- [ ] Testing period: 1-2 weeks
- [ ] Bug reports collected
- [ ] Feedback documented
- [ ] Critical bugs fixed
- [ ] New build uploaded (if needed)

### External Testing (Optional)
- [ ] External testing group created
- [ ] 50-100 beta testers
- [ ] Testing instructions provided
- [ ] Feedback form shared
- [ ] Analytics reviewed
- [ ] Crash reports monitored

---

## 🚀 SUBMISSION

### Pre-Submission
- [ ] All checklists above complete
- [ ] Final build tested on 3+ devices
- [ ] No known critical bugs
- [ ] Performance acceptable
- [ ] Screenshots finalized
- [ ] Description finalized
- [ ] Legal review complete (if company)

### Submission
- [ ] Build selected
- [ ] Screenshots uploaded
- [ ] Description copy-pasted
- [ ] Keywords added
- [ ] Age rating confirmed
- [ ] In-app purchases linked
- [ ] Review notes written
- [ ] Demo account provided (if needed)
- [ ] Contact information verified
- [ ] Submit for review

### Review Notes for Apple
```
Thank you for reviewing Zenith!

DEMO ACCOUNT (if requesting):
Email: demo@zenithfit.app
Password: Demo2026!

SUBSCRIPTION TESTING:
Please use sandbox tester account to test Zenith Pro subscription.
7-day free trial is available for new users.

HEALTH DATA:
App requests access to Apple Health for:
- Heart rate (optional, enhances workout analytics)
- HRV (optional, for recovery score)
- Resting heart rate (optional)
- Sleep data (optional)
All health features work without granting permissions.

GPS LOCATION:
Used only during active run tracking.
Background location used to continue tracking when app is backgrounded.
User can deny location; app works without it.

NOTIFICATIONS:
Used for streak reminders, achievement unlocks, and workout suggestions.
All notifications can be disabled in Settings.

If you have any questions, please contact: support@zenithfit.app

Thank you!
```

---

## 📊 POST-SUBMISSION

### Monitoring (First 24 hours)
- [ ] Check App Store Connect for status updates
- [ ] Respond to any metadata rejection within 24h
- [ ] Monitor email for Apple communication
- [ ] Have team on standby for quick fixes

### App Review
- [ ] Average review time: 24-48 hours
- [ ] Respond to any review questions within 24h
- [ ] Fix any issues and resubmit if rejected
- [ ] Celebrate approval! 🎉

### Launch Day
- [ ] App goes live in App Store
- [ ] Post on social media
- [ ] Email subscribers (if you have list)
- [ ] Submit to Product Hunt
- [ ] Monitor reviews and ratings
- [ ] Respond to user feedback
- [ ] Monitor crash reports
- [ ] Check analytics (downloads, conversions)

---

## 📈 POST-LAUNCH (Week 1)

### Monitoring
- [ ] Daily crash reports check
- [ ] Daily review monitoring
- [ ] Respond to all reviews (positive and negative)
- [ ] Monitor subscription conversion rate
- [ ] Track trial-to-paid conversion
- [ ] Monitor retention (D1, D7, D30)

### Support
- [ ] Check support email daily
- [ ] Respond within 24 hours
- [ ] Create FAQ based on common questions
- [ ] Document bugs for v1.0.1

### Marketing
- [ ] App Store optimization (ASO)
- [ ] Encourage reviews (in-app prompt)
- [ ] Share user testimonials
- [ ] Engage with fitness communities
- [ ] Create content (blog, YouTube)

---

## 🐛 VERSION 1.0.1 (Bug Fix Release)

Plan for release 1-2 weeks after launch:
- [ ] Fix critical bugs from user reports
- [ ] Improve onboarding based on feedback
- [ ] Optimize performance issues
- [ ] Add small QOL improvements
- [ ] Submit update with "Bug fixes and improvements"

---

## ✅ FINAL CHECKLIST

- [ ] All code reviewed
- [ ] All features tested
- [ ] All assets uploaded
- [ ] All legal docs published
- [ ] TestFlight testing complete
- [ ] Submission ready
- [ ] Team briefed on launch plan
- [ ] Support processes in place
- [ ] Analytics configured
- [ ] Monitoring tools ready

**READY TO SHIP?** 🚀

---

**Good luck with your launch!**

Remember: Version 1.0 doesn't need to be perfect. Ship it, learn from users, and iterate quickly. You've got this! 💪
