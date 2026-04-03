#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(BodyMap3DViewManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(snapshotJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(stimulusLensJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(regionPanelsJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(activeLens, NSString)
RCT_EXPORT_VIEW_PROPERTY(overlayMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(cameraPreset, NSString)
RCT_EXPORT_VIEW_PROPERTY(selectedRegionId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(onRegionPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onInteractionStateChange, RCTBubblingEventBlock)

@end
