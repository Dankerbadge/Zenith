import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef } from "react";
import {
    Animated,
    Easing,
    Modal,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

export default function RankUpModal({
  visible,
  rankName,
  rankColor,
  onClose,
}: {
  visible: boolean;
  rankName: string;
  rankColor: string;
  onClose: () => void;
}) {
  const scale = useRef(new Animated.Value(0.96)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const glowColors = useMemo(
    () => [`${rankColor}55`, `${rankColor}10`, "rgba(0,0,0,0)"] as const,
    [rankColor]
  );

  useEffect(() => {
    if (!visible) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    pulse.setValue(0);
    opacity.setValue(0);
    scale.setValue(0.96);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();

    return () => loop.stop();
  }, [visible, opacity, scale, pulse]);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `I just ranked up in Zenith: ${rankName} ⚡`,
      });
    } catch {}
  };

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] });

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          {/* Ambient glow */}
          <LinearGradient colors={["#000", "#0B0B0B"]} style={StyleSheet.absoluteFillObject} />
          <LinearGradient colors={glowColors} style={styles.glow} />

          {/* Pulse ring */}
          <Animated.View style={[styles.pulseRing, { borderColor: `${rankColor}55`, opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]} />

          <Text style={styles.kicker}>RANK UP</Text>
          <Text style={[styles.title, { color: rankColor }]}>{rankName}</Text>
          <Text style={styles.sub}>You just leveled your identity. Keep stacking wins.</Text>

          <View style={styles.actions}>
            <TouchableOpacity onPress={handleShare} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>SHARE</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} style={styles.btnSolid}>
              <LinearGradient
                colors={[rankColor, "#00D9FF"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.btnSolidGrad}
              >
                <Text style={styles.btnSolidText}>CONTINUE</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "#1F1F1F",
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    left: -60,
    right: -60,
    top: -60,
    bottom: -60,
    opacity: 0.95,
  },
  pulseRing: {
    position: "absolute",
    width: 340,
    height: 340,
    borderRadius: 340,
    borderWidth: 2,
    alignSelf: "center",
    top: -120,
  },
  kicker: {
    color: "#A0A0A0",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 10,
  },
  title: { fontSize: 34, fontWeight: "900", letterSpacing: 0.4, marginBottom: 8 },
  sub: { color: "#C8C8C8", fontSize: 13, fontWeight: "700", lineHeight: 18, maxWidth: 320 },
  actions: { flexDirection: "row", marginTop: 18 },
  btnGhost: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    paddingVertical: 14,
    alignItems: "center",
    marginRight: 10,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  btnGhostText: { color: "#D0D0D0", fontWeight: "900", letterSpacing: 1 },
  btnSolid: { flex: 1, borderRadius: 16, overflow: "hidden" },
  btnSolidGrad: { paddingVertical: 14, alignItems: "center" },
  btnSolidText: { color: "#0A0A0A", fontWeight: "900", letterSpacing: 1 },
});
