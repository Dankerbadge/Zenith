export const RUN_METRIC_VERSION = {
  ACCURACY_MODEL: 'accuracy_v1',
  GPS_PROCESSING: 'gps_processing_v1',
  STRIDE_MODEL: 'stride_model_v1',
  CALORIE_FORMULA: 'calorie_formula_v1',
  SPLIT_LOGIC: 'split_logic_v1',
  CONFIDENCE_MODEL: 'confidence_v1',
  REFINEMENT_MODEL: 'refinement_v1',
} as const;

export type RunMetricVersionSet = {
  accuracyModelVersion: string;
  gpsProcessingVersion: string;
  strideModelVersion: string;
  calorieFormulaVersion: string;
  splitLogicVersion: string;
  confidenceModelVersion: string;
  refinementModelVersion: string;
};

export function createRunMetricVersionSet(
  override: Partial<RunMetricVersionSet> = {}
): RunMetricVersionSet {
  return {
    accuracyModelVersion: override.accuracyModelVersion || RUN_METRIC_VERSION.ACCURACY_MODEL,
    gpsProcessingVersion: override.gpsProcessingVersion || RUN_METRIC_VERSION.GPS_PROCESSING,
    strideModelVersion: override.strideModelVersion || RUN_METRIC_VERSION.STRIDE_MODEL,
    calorieFormulaVersion: override.calorieFormulaVersion || RUN_METRIC_VERSION.CALORIE_FORMULA,
    splitLogicVersion: override.splitLogicVersion || RUN_METRIC_VERSION.SPLIT_LOGIC,
    confidenceModelVersion: override.confidenceModelVersion || RUN_METRIC_VERSION.CONFIDENCE_MODEL,
    refinementModelVersion: override.refinementModelVersion || RUN_METRIC_VERSION.REFINEMENT_MODEL,
  };
}
