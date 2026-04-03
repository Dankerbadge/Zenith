# ZENITH V1.1 - COMPLETE INSTALLATION GUIDE

## 🚀 NEW FEATURES ADDED:
1. ✅ Social Sharing (workouts, runs, achievements)
2. ✅ Barcode Scanner (food logging)
3. ✅ Data Export (CSV/PDF)
4. ✅ Enhanced Navigation (fixed all broken links)

---

## 📦 REQUIRED PACKAGES

```bash
# Run all at once
npx expo install expo-sharing expo-file-system expo-barcode-scanner expo-camera expo-image-manipulator expo-media-library react-native-view-shot expo-print
```

---

## 📁 FILE INSTALLATIONS

### STEP 1: Install Services
```bash
# Social Sharing Service
mv ~/Downloads/sharingService.ts ~/Desktop/Zenith/utils/

# Barcode Scanner Service
mv ~/Downloads/barcodeService.ts ~/Desktop/Zenith/utils/
```

### STEP 2: Install Screens
```bash
# Barcode Scanner Screen
mv ~/Downloads/BarcodeScannerScreen.tsx ~/Desktop/Zenith/app/barcode-scanner.tsx
```

---

## 🔧 DASHBOARD FIXES

The dashboard needs updates to add:
1. Store button navigation
2. GPS Run button
3. Working Progress button
4. Share buttons

**REPLACE YOUR DASHBOARD:**

Location: `app/(tabs)/index.tsx`

Key additions:
- Store navigation button
- "Start Run" button for GPS
- Fixed Progress button navigation
- Share achievement/workout buttons

---

## 🍔 FOOD LOGGER UPDATES

Add barcode scanner integration to food logger.

**UPDATE FOOD LOGGER:**

Location: `app/(tabs)/food.tsx` or wherever your food logger is

Add barcode scanner button:
```typescript
<TouchableOpacity 
  onPress={() => router.push('/barcode-scanner?meal=breakfast' as any)}
>
  <Text>📷 Scan Barcode</Text>
</TouchableOpacity>
```

---

## 🏃 GPS RUN INTEGRATION

**ADD TO DASHBOARD:**
```typescript
<TouchableOpacity
  onPress={() => router.push('/live-run' as any)}
>
  <Text>🏃 Start Run</Text>
</TouchableOpacity>
```

---

## 📊 SHARING INTEGRATION

### Add to Run Summary Screen:
```typescript
import { shareRun } from '../utils/sharingService';

// After run completes:
<TouchableOpacity onPress={() => shareRun(runData)}>
  <Text>Share Run 📤</Text>
</TouchableOpacity>
```

### Add to Achievements Screen:
```typescript
import { shareAchievement } from '../utils/sharingService';

<TouchableOpacity onPress={() => shareAchievement(achievement)}>
  <Text>Share 📤</Text>
</TouchableOpacity>
```

### Add to Stats Screen:
```typescript
import { exportWorkoutsAsCSV } from '../utils/sharingService';

<TouchableOpacity onPress={() => exportWorkoutsAsCSV(workouts)}>
  <Text>Export Data 📊</Text>
</TouchableOpacity>
```

---

## 🛒 STORE NAVIGATION

Add to Dashboard or Profile:

```typescript
<TouchableOpacity 
  onPress={() => router.push('/store' as any)}
>
  <Text>🛒 Premium Store</Text>
</TouchableOpacity>
```

---

## 📱 iOS PERMISSIONS (Info.plist)

Add to `ios/Zenith/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Zenith needs camera access to scan food barcodes for quick nutrition logging.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>Zenith needs photo access to save and share your workout images.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>Zenith saves your workout summaries to your photo library.</string>
```

---

## 🤖 ANDROID PERMISSIONS (AndroidManifest.xml)

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

---

## ✅ VERIFICATION CHECKLIST

After installation, test these:

### Social Sharing:
- [ ] Share workout from workout logger
- [ ] Share run from run summary
- [ ] Share achievement from achievements screen
- [ ] Export workouts as CSV

### Barcode Scanner:
- [ ] Open barcode scanner from food logger
- [ ] Scan a real barcode (try any packaged food)
- [ ] Manual barcode entry works
- [ ] Food data populates correctly

### Navigation:
- [ ] Store button visible and clickable
- [ ] "Start Run" button navigates to GPS run
- [ ] Progress button goes to stats screen
- [ ] All tabs working

---

## 🐛 TROUBLESHOOTING

### "Camera permission denied"
- Go to Settings → Zenith → Enable Camera

### "Barcode not found"
- Try manual entry
- Use Open Food Facts website to verify barcode exists
- Some store-brand items may not be in database

### "Sharing not working"
- Test on physical device (not simulator)
- Check permissions in Settings

### "Navigation broken"
- Clear Metro cache: `npx expo start -c`
- Restart app

---

## 🚀 WHAT'S NEXT?

After V1.1 is working:

**V1.2 (Optional - Cloud Sync):**
- Would require Firebase ($0-25/month)
- Cross-device syncing
- Backup/restore

**V1.3 (Optional - Social Feed):**
- Would require backend ($25-100/month)
- Follow friends
- Community challenges

**For now, V1.1 is FREE and adds huge value!**

---

## 📝 TESTING SCRIPT

```bash
# 1. Test barcode scanner
- Open food logger
- Tap barcode button
- Scan any food item
- Verify nutrition data appears

# 2. Test sharing
- Complete a workout
- Tap share button
- Share to notes/messages
- Verify formatted text appears

# 3. Test export
- Go to stats
- Tap export
- Choose save location
- Open CSV file

# 4. Test navigation
- Dashboard → Store (works)
- Dashboard → Start Run (works)
- Quick Actions → Progress (works)
```

---

## 🎉 DONE!

Your app now has:
- Social sharing ✅
- Barcode scanning ✅
- Data export ✅
- Fixed navigation ✅

All without any recurring costs! 🚀
