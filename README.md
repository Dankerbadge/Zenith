# 🏔️ Zenith - Fitness Tracking App

**Transform your fitness journey into an epic adventure**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/zenith)
[![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey.svg)](https://expo.dev)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 📱 What is Zenith?

Zenith is a comprehensive fitness tracking app that gamifies your workout journey. Track workouts, nutrition, and progress while climbing through 27 ranks from Iron to Zenith. Built with React Native and Expo for a native experience on iOS and Android.

**🎯 Core Philosophy:** No streaks. No pressure. Just winning days and steady progress.

---

## ✨ Features

### Free Tier
- 💪 **6 Workout Types** - MET-based calorie calculations
- 🍎 **Food Tracking** - 4 meals with macro breakdowns
- ⚖️ **Weight Logging** - 6 stats with trend analysis
- 🏃 **GPS Running** - Distance, pace, splits, map
- 🏆 **26 Achievements** - Bronze, Silver, Gold tiers
- 🎖️ **27 Ranks** - Iron → Zenith progression
- 🔥 **Winning Days** - Hit targets, earn wins
- 📊 **Stats** - All-time + weekly analytics

### Zenith Pro ($6.99/mo or $49.99/yr)
- ❤️ **HR Zone Analytics** - 5 zones, training effect
- 📈 **Recovery Score** - HRV-based readiness
- 💪 **150+ Exercises** - With instructions
- 🏋️ **PR Tracking** - Personal records + 1RM
- 🔨 **Custom Workouts** - Build templates
- 🏃 **Training Plans** - Marathon programs
- 🔔 **Smart Notifications** - AI suggestions
- 📤 **Data Export** - CSV/PDF

---

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/yourusername/zenith.git
cd zenith

# Install
npm install

# Run
npx expo start
```

**Requirements:** Node.js 18+, Expo CLI

---

## 🎮 Gamification

### XP System
- 50 XP daily cap
- 15 XP per workout
- 15 XP per mile
- Achievement bonuses

### Rank Progression
27 ranks requiring BOTH:
- Total XP threshold
- Winning Days count

**Example:** Gold I requires 8,800 XP AND 60 winning days.

### Winning Days
A winning day = Workout logged + Calorie target hit (±100 cal)

No streaks. Every day is independent.

---

## 📊 Tech Stack

- React Native 0.81.5
- Expo SDK 54
- TypeScript
- Expo Router (file-based routing)
- AsyncStorage (local-first)
- React Native Health (iOS)
- React Native Maps

---

## 📁 Structure

```
app/
  (tabs)/           # Main navigation
  auth/             # Login/signup
  context/          # Auth state
  *.tsx             # Standalone screens
components/         # Reusable UI
utils/              # Business logic
docs/               # Documentation
```

---

## 💰 Monetization

- **Free**: Core features, no ads
- **Subscription**: $6.99/mo or $49.99/yr
- **One-time packs**: $4.99 each

---

## 🧪 Testing

```bash
npx tsc --noEmit  # Type checking
npm run lint       # Linting
npx expo start     # Run app
```

---

## 📦 Building

```bash
# iOS
eas build --platform ios
eas submit --platform ios

# Android
eas build --platform android
eas submit --platform android
```

---

## 🗺️ Roadmap

- **v1.1**: Social sharing, barcode scanner, widgets
- **v1.2**: Cloud sync, photo food logging
- **v1.3**: Social feed, AI training plans
- **v2.0**: AI coaching, marketplace

---

## 📄 Docs

- [Features](docs/FEATURES.md)
- [Testing Guide](docs/TESTING_GUIDE.md)
- [Launch Checklist](docs/LAUNCH_CHECKLIST.md)
- [Privacy Policy](docs/PRIVACY_POLICY.md)

---

## 📧 Support

support@zenithfit.app

---

**Built with ❤️ - Reach Your Peak 🏔️**
