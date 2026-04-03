import * as Haptics from "expo-haptics";
import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera"; import { router } from "expo-router"; import React, { useCallback, useState } from "react"; import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';


export default function FoodScanModal() {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  const onScanned = useCallback(
    (event: BarcodeScanningResult) => {
      if (locked || !event?.data) return;
      setLocked(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.replace({
        pathname: "/(modals)/food",
        params: { barcode: event.data },
      } as any);
    },
    [locked]
  );

  if (!permission) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Loading camera...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Camera access needed</Text>
          <Text style={styles.sub}>Enable camera to scan barcodes instantly.</Text>
          <Pressable style={styles.button} onPress={() => requestPermission()}>
            <Text style={styles.buttonText}>Allow Camera</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.ghost]} onPress={() => router.back()}>
            <Text style={styles.ghostText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{
          barcodeTypes: [
            "upc_a",
            "upc_e",
            "ean13",
            "ean8",
          ],
        }}
        onBarcodeScanned={onScanned}
      />
      <View pointerEvents="none" style={styles.overlay}>
        <View style={styles.scanBox} />
        <Text style={styles.sub}>{locked ? "Opening product..." : "Center barcode in the box"}</Text>
      </View>

      <View style={styles.topBar}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  topBar: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backText: { color: "#FFF", fontWeight: "700" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanBox: {
    width: 250,
    height: 150,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#00D9FF",
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  title: { color: "#FFF", fontWeight: "800", fontSize: 20, textAlign: "center" },
  sub: { color: "#D4EAF2", textAlign: "center", marginTop: 12, fontWeight: "600" },
  button: {
    backgroundColor: "#00D9FF",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 14,
  },
  buttonText: { color: "#03141A", fontWeight: "900" },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#3B4B54" },
  ghostText: { color: "#C7DFE7", fontWeight: "700" },
});
