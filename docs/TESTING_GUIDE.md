# Zenith - Complete Testing Guide

**Comprehensive guide to testing all features before launch**

---

## 🎯 **Testing Philosophy**

Test on **real devices** whenever possible. Simulators miss:
- Haptic feedback
- GPS accuracy
- Health data integration
- Performance issues
- Touch responsiveness

---

## 📱 **Device Requirements**

### **Minimum Test Coverage:**
- ✅ iPhone 12+ (iOS 16+)
- ✅ Android Pixel 6+ (Android 12+)
- ✅ iPad (optional, for tablet layout)

### **Recommended Additional:**
- iPhone SE (small screen)
- Android Samsung (OneUI skin)
- Older device (iOS 15, Android 11)

---

## 🚀 **Pre-Test Setup**

### **1. Fresh Install**
```bash
# Delete app from device
# Clear Metro cache
npx expo start -c

# Reinstall
npx expo run:ios  # or run:android
```

### **2. Enable All Permissions**
- Location (Always)
- Notifications (All types)
- Health Data (All categories)
- Camera (for barcode scanner in production)

### **3. Create Test Account**
```
Email: test@zenith.app
Password: Test123!
Name: Tester
```

---

## ✅ **Testing Checklist**

### **Phase 1: Authentication & Onboarding**

#### **1.1 Signup Flow**
- [ ] Tap "Create Account"
- [ ] Enter first name, email, password
- [ ] Verify account creation
- [ ] Check "Remember Me" saves correctly

**Expected:** Navigates to onboarding screen 1

#### **1.2 Onboarding (11 Screens)**
- [ ] Screen 1: Welcome
- [ ] Screen 2: Name entry (auto-populated)
- [ ] Screen 3: Age (test: 25 years)
- [ ] Screen 4: Sex (Male/Female)
- [ ] Screen 5: Height (5'10" or 178cm)
- [ ] Screen 6: Current weight (180 lbs or 82 kg)
- [ ] Screen 7: Goal weight (170 lbs or 77 kg)
- [ ] Screen 8: Fitness goal (Lose Fat)
- [ ] Screen 9: Exercise preference (Lifting)
- [ ] Screen 10: Intensity (Extreme)
- [ ] Screen 11: Activity level (Active)
- [ ] Verify TDEE calculation shows
- [ ] Tap "Complete Onboarding"
- [ ] Receive 50 XP onboarding bonus

**Expected:** Navigates to dashboard, rank is Iron IV (50 XP)

#### **1.3 Login Flow**
- [ ] Logout from profile
- [ ] Login with same credentials
- [ ] Verify data persists
- [ ] Check "Remember Me" works

---

### **Phase 2: Dashboard & Core Features**

#### **2.1 Dashboard Elements**
- [ ] Winning day status shows (initially "Not Yet")
- [ ] Rank badge displays (Iron IV)
- [ ] XP progress shows (50/100)
- [ ] Daily streak displays (0 or 1)
- [ ] Winning days total shows (0)
- [ ] Calorie progress (0/target)
- [ ] Water intake (0/90oz)
- [ ] Quick action buttons visible

#### **2.2 Water Intake**
- [ ] Tap "+8oz" button
- [ ] Verify water count increases
- [ ] Verify progress bar fills
- [ ] Add multiple times
- [ ] Check persistence (close/reopen app)

---

### **Phase 3: Workout Logging**

#### **3.1 Quick Workout**
- [ ] Tap "Log Workout"
- [ ] Select "Quick Workout"
- [ ] Duration: 30 minutes
- [ ] Intensity: Medium
- [ ] Verify calorie calculation shows
- [ ] Tap "Log Workout"
- [ ] Verify success message
- [ ] Check XP increased by 15 (now 65/100)
- [ ] Check workout appears in "Today's Workouts"

#### **3.2 Cardio Workout**
- [ ] Log Workout → Cardio
- [ ] Duration: 45 minutes
- [ ] Intensity: High
- [ ] Verify calories calculated correctly
- [ ] Verify XP cap message if hitting 50 XP

#### **3.3 Lifting Workout**
- [ ] Log Workout → Lifting
- [ ] Duration: 60 minutes
- [ ] Intensity: Extreme
- [ ] Check calories (should be ~360 for 180lb user)

#### **3.4 Edit Workout**
- [ ] Tap workout in list
- [ ] Edit duration to 20 minutes
- [ ] Verify calories recalculate
- [ ] Save changes

#### **3.5 Delete Workout**
- [ ] Tap workout
- [ ] Tap "Delete"
- [ ] Confirm deletion
- [ ] Verify XP adjusts
- [ ] Verify workout removed from list

#### **3.6 XP Daily Cap**
- [ ] Log 4+ workouts (60+ XP)
- [ ] Verify "Daily XP cap reached" message
- [ ] Verify XP stops at 50
- [ ] Check next day resets cap

---

### **Phase 4: Food Tracking**

#### **4.1 Add Breakfast**
- [ ] Navigate to Food tab (or tap "Log Food")
- [ ] Tap "+ Add Food" under Breakfast
- [ ] Name: "Scrambled Eggs"
- [ ] Calories: 200
- [ ] Protein: 18g
- [ ] Carbs: 2g
- [ ] Fats: 14g
- [ ] Tap "Add Food"
- [ ] Verify food appears in breakfast list
- [ ] Verify calorie total updates

#### **4.2 Add Multiple Meals**
- [ ] Breakfast: 500 calories (eggs + toast)
- [ ] Lunch: 600 calories (chicken salad)
- [ ] Dinner: 800 calories (steak + veggies)
- [ ] Snacks: 200 calories (protein bar)
- [ ] Total: 2100 calories

#### **4.3 Macro Totals**
- [ ] Verify protein total correct
- [ ] Verify carbs total correct
- [ ] Verify fats total correct
- [ ] Check if within target range

#### **4.4 Edit Food**
- [ ] Tap food item
- [ ] Edit calories
- [ ] Verify totals recalculate

#### **4.5 Delete Food**
- [ ] Tap food item
- [ ] Tap "Delete"
- [ ] Verify totals adjust

---

### **Phase 5: Weight Tracking**

#### **5.1 Log Weight**
- [ ] Navigate to Weight tab (or tap "Log Weight")
- [ ] Enter weight: 179 lbs
- [ ] Tap "Log Weight"
- [ ] Verify success message

#### **5.2 Stats Display**
- [ ] Current weight: 179 lbs
- [ ] Starting weight: 180 lbs
- [ ] Goal weight: 170 lbs
- [ ] Weight change: -1 lb
- [ ] Progress: ~10% (1 of 10 lbs lost)
- [ ] BMI calculated

#### **5.3 Multiple Logs**
- [ ] Log weight on Day 1: 180 lbs
- [ ] Log weight on Day 3: 179 lbs
- [ ] Log weight on Day 7: 177 lbs
- [ ] Verify 7-day log shows all entries
- [ ] Check trend (should show decrease)

#### **5.4 Edit Weight**
- [ ] Tap weight entry
- [ ] Edit to 178 lbs
- [ ] Verify stats recalculate

#### **5.5 Delete Weight**
- [ ] Tap weight entry
- [ ] Delete
- [ ] Verify stats adjust

---

### **Phase 6: GPS Running**

#### **6.1 Start Run (Must Be Outdoors)**
- [ ] Tap "Start Run" (or navigate to live-run)
- [ ] Grant location permission if prompted
- [ ] Verify GPS acquiring location
- [ ] Wait for GPS lock
- [ ] Tap "Start Run"

#### **6.2 During Run**
- [ ] Verify distance increasing (0.00 → 0.01 → etc)
- [ ] Verify duration counting (00:00 → 00:01)
- [ ] Verify pace calculating (should start at ~0 then stabilize)
- [ ] Run at least 0.1 miles
- [ ] Test reactions:
  - [ ] Tap 💪 button
  - [ ] Tap 🔥 button
  - [ ] Verify reaction count increases

#### **6.3 Splits**
- [ ] Run 1 full mile
- [ ] Verify auto-split at 1.0 miles
- [ ] Check split pace
- [ ] Tap "Mark Split" manually
- [ ] Verify manual split added

#### **6.4 Pause/Resume**
- [ ] Tap "Pause"
- [ ] Verify tracking stops
- [ ] Wait 10 seconds
- [ ] Tap "Resume"
- [ ] Verify tracking continues

#### **6.5 Finish Run**
- [ ] Tap "Finish"
- [ ] Verify confirmation dialog
- [ ] Confirm finish
- [ ] Verify navigates to run summary

#### **6.6 Run Summary**
- [ ] Total distance displayed
- [ ] Total duration displayed
- [ ] Average pace displayed
- [ ] Calories calculated
- [ ] Map with route shown
- [ ] Splits list visible
- [ ] Reactions count shown
- [ ] "Share Run" button visible (test in v1.1)
- [ ] "Save to Health" button (if iOS)

#### **6.7 GPS Edge Cases**
- [ ] Test indoor (should warn poor GPS)
- [ ] Test with location services off
- [ ] Test backgrounding app during run
- [ ] Test low battery during run
- [ ] Test airplane mode

---

### **Phase 7: Achievements**

#### **7.1 View Achievements**
- [ ] Navigate to Achievements tab
- [ ] Verify count (e.g., "1/26" if only onboarding)
- [ ] Verify category filters work:
  - [ ] All
  - [ ] Consistency
  - [ ] Volume
  - [ ] Discipline
  - [ ] Milestones
  - [ ] Elite

#### **7.2 Unlock Achievement**
- [ ] Complete requirements for "First Steps" (1 winning day)
- [ ] Verify achievement unlocks
- [ ] Check XP bonus received
- [ ] Verify count updates (2/26)
- [ ] Verify achievement shows as unlocked (colored)

#### **7.3 Progression**
Test each category:
- [ ] Consistency: Complete 7-day winning streak
- [ ] Volume: Log 10 workouts
- [ ] Discipline: Achieve 5 winning days
- [ ] Milestones: Reach Bronze I
- [ ] Elite: Run 1 mile total

---

### **Phase 8: Rank Progression**

#### **8.1 Current Rank View**
- [ ] Navigate to Rank tab
- [ ] Verify current rank shown (Iron IV initially with 50 XP)
- [ ] Verify rank badge displayed
- [ ] Check XP progress bar (50/100)
- [ ] Check Winning Days progress bar (0/3)

#### **8.2 Next Rank Preview**
- [ ] Verify "Next Rank" section shows
- [ ] Shows Iron III requirements (100 XP, 3 winning days)
- [ ] Shows both progress bars
- [ ] Shows "~X days" estimate

#### **8.3 Rank Up**
- [ ] Earn 50 more XP (total 100)
- [ ] Achieve 3 winning days
- [ ] Verify rank up occurs
- [ ] Check congratulations message
- [ ] Verify new rank badge
- [ ] Check dashboard updates

#### **8.4 Rank Ladder**
- [ ] Scroll down to see all 27 ranks
- [ ] Verify color coding:
  - [ ] Iron (gray)
  - [ ] Bronze (bronze)
  - [ ] Silver (silver)
  - [ ] Gold (gold)
  - [ ] Platinum (platinum)
  - [ ] Diamond (cyan)
  - [ ] Zenith (purple)

---

### **Phase 9: Statistics**

#### **9.1 Overview Cards**
- [ ] Navigate to Stats tab
- [ ] Verify "All Time" tab active
- [ ] Check Total Workouts (should match logged)
- [ ] Check Winning Days (should match achieved)
- [ ] Check Longest Streak
- [ ] Check Total XP

#### **9.2 This Week View**
- [ ] Tap "This Week" tab
- [ ] Verify stats for current week only
- [ ] Check workouts this week
- [ ] Check XP earned this week
- [ ] Check average calories

#### **9.3 Workout Breakdown**
- [ ] Scroll to "Workout Breakdown"
- [ ] Verify bar chart shows
- [ ] Check breakdown by type matches logs
- [ ] Verify "Quick Workout" count
- [ ] Verify other types

#### **9.4 Details Section**
- [ ] Current streak display
- [ ] Calories burned total
- [ ] Weight logs count
- [ ] Favorite workout type
- [ ] Account age

---

### **Phase 10: Profile**

#### **10.1 View Profile**
- [ ] Navigate to Profile tab
- [ ] Verify avatar shows (first initial)
- [ ] Check name displays
- [ ] Check email displays
- [ ] Check "Member for X days"

#### **10.2 Basic Info**
- [ ] Age: 25
- [ ] Sex: Male
- [ ] Height: 5'10"
- [ ] Current weight: 179 lbs
- [ ] Starting weight: 180 lbs
- [ ] Goal weight: 170 lbs

#### **10.3 Goals & Activity**
- [ ] Goal: Lose Fat
- [ ] Intensity: Extreme
- [ ] Exercise type: Lifting
- [ ] Activity level: Active

#### **10.4 Nutrition**
- [ ] TDEE displayed (e.g., 2836 cal)
- [ ] Daily target (e.g., 2336 cal for 500 deficit)
- [ ] Calorie range (e.g., 2236-2436)
- [ ] Water goal: 90 oz

#### **10.5 Edit Profile**
- [ ] Tap "Edit"
- [ ] Change age to 26
- [ ] Change current weight to 178
- [ ] Tap "Recalculate TDEE"
- [ ] Verify TDEE updates
- [ ] Save changes
- [ ] Verify changes persist

#### **10.6 Logout**
- [ ] Tap "Logout"
- [ ] Verify confirmation dialog
- [ ] Confirm logout
- [ ] Verify navigates to login
- [ ] Verify can log back in

---

### **Phase 11: Winning Days System**

#### **11.1 Winning Day Requirements**
- [ ] Log 1+ workout
- [ ] Hit calorie target ±100
- [ ] Verify winning day banner shows
- [ ] Check streak increases
- [ ] Check winning days total increases

#### **11.2 Not a Winning Day**
Test each scenario:
- [ ] Log workout but miss calories → Not winning
- [ ] Hit calories but no workout → Not winning
- [ ] Neither → Not winning

#### **11.3 Streak Logic**
- [ ] Day 1: Winning day → Streak: 1
- [ ] Day 2: Winning day → Streak: 2
- [ ] Day 3: Not winning → Streak: 0
- [ ] Day 4: Winning day → Streak: 1 (streak resets)

---

### **Phase 12: Premium Features (Zenith Pro)**

#### **12.1 Store Screen**
- [ ] Navigate to Store (must add button or direct link)
- [ ] Verify Zenith Pro card shows
- [ ] Check pricing: $6.99/mo or $49.99/yr
- [ ] Verify "7-day free trial" displayed
- [ ] Check feature list (15 items)
- [ ] Verify pack cards show (3 packs)
- [ ] Check pack prices ($4.99 each)

#### **12.2 Premium Gate**
- [ ] Navigate to workout analytics (should be gated)
- [ ] Verify locked screen shows
- [ ] Check "Upgrade to Zenith Pro" message
- [ ] Tap "Upgrade"
- [ ] Verify navigates to store

#### **12.3 Purchase Flow (Sandbox Mode)**
- [ ] Tap "START 7-DAY FREE TRIAL"
- [ ] Verify IAP prompt (or test mode confirmation)
- [ ] Complete purchase
- [ ] Verify subscription activates
- [ ] Verify premium features unlock

#### **12.4 Heart Rate Analytics**
*(Requires Premium + Apple Health data)*
- [ ] Navigate to workout-analytics
- [ ] Verify 5 HR zones display
- [ ] Check time in each zone
- [ ] Verify chart renders
- [ ] Check training effect

#### **12.5 Recovery Score**
*(Requires Premium + HRV data)*
- [ ] Check recovery score (0-100)
- [ ] Verify color coding
- [ ] Check recommendations
- [ ] View 7-day trend

#### **12.6 Exercise Packs**
- [ ] Purchase Lifting Pack ($4.99)
- [ ] Verify 150+ exercises accessible
- [ ] Browse exercises by muscle group
- [ ] View exercise details
- [ ] Check instructions and tips

---

### **Phase 13: Notifications**

#### **13.1 Notification Settings**
- [ ] Navigate to notification settings
- [ ] Verify 8 notification types listed
- [ ] Toggle each on/off
- [ ] Set custom time for streak reminder
- [ ] Set water reminder interval
- [ ] Verify changes save

#### **13.2 Notification Delivery**
*(Must wait for scheduled times)*
- [ ] Streak reminder (at set time)
- [ ] Water reminder (at interval)
- [ ] Winning day prompt (mid-day)
- [ ] Achievement unlock (instant)
- [ ] Rank up (instant)

#### **13.3 Notification Actions**
- [ ] Tap notification
- [ ] Verify app opens to relevant screen
- [ ] Test deep linking works

---

### **Phase 14: Data Persistence**

#### **14.1 App Restart**
- [ ] Force quit app
- [ ] Reopen app
- [ ] Verify all data persists:
  - [ ] User logged in
  - [ ] Workouts saved
  - [ ] Food logs saved
  - [ ] Weight entries saved
  - [ ] XP/rank correct
  - [ ] Achievements saved

#### **14.2 Background/Foreground**
- [ ] Use app normally
- [ ] Background app (home button)
- [ ] Wait 5 minutes
- [ ] Foreground app
- [ ] Verify data intact

#### **14.3 Multi-Day Testing**
- [ ] Use app for 3+ days
- [ ] Log data each day
- [ ] Verify historical data shows
- [ ] Check winning days accumulate
- [ ] Check XP accumulates

---

### **Phase 15: Edge Cases & Error Handling**

#### **15.1 Network Loss**
- [ ] Enable airplane mode
- [ ] Try to use app
- [ ] Verify offline features work (workout/food/weight logging)
- [ ] Verify GPS running requires location
- [ ] Verify appropriate error messages

#### **15.2 Storage Full**
- [ ] Fill device storage near capacity
- [ ] Try to log data
- [ ] Verify graceful handling
- [ ] Check error message

#### **15.3 Permission Denied**
- [ ] Deny location permission
- [ ] Try to start run
- [ ] Verify error message
- [ ] Verify prompt to enable in Settings

#### **15.4 Invalid Inputs**
- [ ] Try negative calories
- [ ] Try negative weight
- [ ] Try future date
- [ ] Try empty fields
- [ ] Verify validation works

#### **15.5 Rapid Tapping**
- [ ] Rapidly tap "Log Workout" button
- [ ] Verify no duplicate logs
- [ ] Test debouncing works

---

### **Phase 16: Performance**

#### **16.1 App Launch Time**
- [ ] Force quit app
- [ ] Launch app
- [ ] Time from tap to dashboard
- [ ] **Target:** < 3 seconds

#### **16.2 Screen Transitions**
- [ ] Navigate between tabs
- [ ] **Target:** Smooth 60fps
- [ ] No jank or stuttering

#### **16.3 Scroll Performance**
- [ ] Scroll through rank ladder (27 ranks)
- [ ] Scroll through achievements (26 items)
- [ ] Scroll through food logs
- [ ] **Target:** Smooth scrolling

#### **16.4 Large Data Set**
- [ ] Add 100+ workouts (simulate)
- [ ] Add 100+ food entries
- [ ] Check stats screen performance
- [ ] Verify no lag

---

### **Phase 17: UI/UX Polish**

#### **17.1 Visual Design**
- [ ] All gradients render correctly
- [ ] Colors match brand (cyan/purple/green)
- [ ] Dark theme consistent
- [ ] No white flashes
- [ ] Proper contrast for readability

#### **17.2 Typography**
- [ ] All text readable
- [ ] Font sizes appropriate
- [ ] Line heights comfortable
- [ ] No truncated text

#### **17.3 Spacing**
- [ ] Consistent padding
- [ ] Proper margins
- [ ] Elements not cramped
- [ ] Touch targets large enough (44×44 minimum)

#### **17.4 Animations**
- [ ] Smooth transitions
- [ ] No jarring movements
- [ ] Loading indicators show
- [ ] Haptic feedback works (iOS)

---

## 🐛 **Bug Reporting Template**

When you find a bug, report it like this:

```
**Bug:** Unable to log workout

**Steps to Reproduce:**
1. Tap "Log Workout"
2. Select "Cardio"
3. Enter duration: 30
4. Tap "Log Workout"

**Expected:** Workout logs successfully

**Actual:** App crashes / Error message / etc.

**Device:** iPhone 14, iOS 17.2

**App Version:** 1.0.0

**Screenshots:** [Attach]

**Additional Notes:** Only happens with Cardio type
```

---

## ✅ **Final Checklist Before Launch**

- [ ] All Phase 1-17 tests passed
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] UI polished
- [ ] Permissions working
- [ ] Data persistence verified
- [ ] Multi-device tested
- [ ] Beta tester feedback addressed
- [ ] App Store screenshots taken
- [ ] Privacy policy accessible
- [ ] Terms of service accessible

---

## 📊 **Test Results Tracking**

Create a spreadsheet with:
- Feature name
- Test date
- Device tested
- Pass/Fail
- Notes
- Bug ID (if failed)

---

## 🎯 **Success Criteria**

**Minimum for Launch:**
- 95% of core features (Phase 1-11) passing
- No critical bugs (crashes, data loss)
- Performance acceptable (< 3s launch)
- UI polished and consistent

**Nice to Have:**
- 100% of tests passing
- All edge cases handled
- Perfect performance

---

## 📱 **Real-World Usage Testing**

After technical testing, use the app yourself for 7 days like a real user:
- Log actual workouts
- Track actual food
- Run actual miles
- Try to break it
- Note friction points
- Collect feedback from friends/family

---

**Good luck with testing! 🚀**

*Last Updated: January 31, 2026*
