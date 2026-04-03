import React from 'react';
import { requireNativeComponent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';

export type BodyMapRegionPressEvent = {
  regionId: number;
  regionKey: string;
  score: number;
};

type BodyMap3DNativeViewProps = {
  style?: StyleProp<ViewStyle>;
  snapshotJson?: string;
  stimulusLensJson?: string;
  regionPanelsJson?: string;
  activeLens?: string;
  overlayMode?: string;
  cameraPreset?: string;
  selectedRegionId?: number;
  onRegionPress?: (event: NativeSyntheticEvent<BodyMapRegionPressEvent>) => void;
};

const NativeBodyMap3DView = requireNativeComponent<BodyMap3DNativeViewProps>('BodyMap3DView');

export default function BodyMap3DNativeView(props: BodyMap3DNativeViewProps) {
  return <NativeBodyMap3DView {...props} />;
}
