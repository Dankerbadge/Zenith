// MET-based Calorie Calculation System
// Based on Compendium of Physical Activities

export interface METActivity {
  id: string;
  category: 'lifting' | 'running' | 'calisthenics' | 'sports' | 'flexibility';
  name: string;
  met: number;
  intensity: 'light' | 'moderate' | 'vigorous';
}

// MET Database - Scientifically backed values
export const MET_DATABASE: METActivity[] = [
  // LIFTING
  { id: 'lifting_light', category: 'lifting', name: 'Lifting (Light)', met: 3.0, intensity: 'light' },
  { id: 'lifting_moderate', category: 'lifting', name: 'Lifting (Moderate)', met: 3.5, intensity: 'moderate' },
  { id: 'lifting_heavy', category: 'lifting', name: 'Lifting (Heavy)', met: 6.0, intensity: 'vigorous' },
  
  // RUNNING / WALKING
  { id: 'walking_casual', category: 'running', name: 'Walking (Casual)', met: 3.3, intensity: 'light' },
  { id: 'walking_brisk', category: 'running', name: 'Walking (Brisk)', met: 4.3, intensity: 'moderate' },
  { id: 'jogging', category: 'running', name: 'Jogging', met: 7.0, intensity: 'moderate' },
  { id: 'running_moderate', category: 'running', name: 'Running (6 mph)', met: 9.8, intensity: 'vigorous' },
  { id: 'running_fast', category: 'running', name: 'Running (8 mph)', met: 11.0, intensity: 'vigorous' },
  
  // CALISTHENICS
  { id: 'calisthenics_light', category: 'calisthenics', name: 'Calisthenics (Light)', met: 3.8, intensity: 'light' },
  { id: 'calisthenics_moderate', category: 'calisthenics', name: 'Calisthenics (Moderate)', met: 6.0, intensity: 'moderate' },
  { id: 'calisthenics_vigorous', category: 'calisthenics', name: 'Calisthenics (Vigorous)', met: 8.0, intensity: 'vigorous' },
  
  // SPORTS
  { id: 'basketball', category: 'sports', name: 'Basketball', met: 6.5, intensity: 'vigorous' },
  { id: 'soccer', category: 'sports', name: 'Soccer', met: 7.0, intensity: 'vigorous' },
  { id: 'tennis', category: 'sports', name: 'Tennis', met: 7.3, intensity: 'vigorous' },
  { id: 'swimming', category: 'sports', name: 'Swimming', met: 6.0, intensity: 'moderate' },
  
  // FLEXIBILITY / YOGA
  { id: 'yoga_light', category: 'flexibility', name: 'Yoga (Hatha)', met: 2.5, intensity: 'light' },
  { id: 'yoga_moderate', category: 'flexibility', name: 'Yoga (Power)', met: 4.0, intensity: 'moderate' },
  { id: 'stretching', category: 'flexibility', name: 'Stretching', met: 2.3, intensity: 'light' },
  { id: 'pilates', category: 'flexibility', name: 'Pilates', met: 3.0, intensity: 'light' },
];

/**
 * Calculate calories burned using MET formula
 * Formula: (MET × 3.5 × bodyweight_kg) / 200 × minutes
 * 
 * @param met - Metabolic Equivalent of Task
 * @param bodyWeightLbs - User's body weight in pounds
 * @param durationMinutes - Duration of activity in minutes
 * @returns Calories burned
 */
export function calculateCaloriesBurned(
  met: number,
  bodyWeightLbs: number,
  durationMinutes: number
): number {
  const bodyWeightKg = bodyWeightLbs * 0.453592; // Convert lbs to kg
  const caloriesPerMinute = (met * 3.5 * bodyWeightKg) / 200;
  const totalCalories = caloriesPerMinute * durationMinutes;
  return Math.round(totalCalories);
}

/**
 * Get MET value by activity ID
 */
export function getMETByActivityId(activityId: string): number {
  const activity = MET_DATABASE.find(a => a.id === activityId);
  return activity ? activity.met : 3.5; // Default to moderate if not found
}

/**
 * Get MET activity by category and intensity
 */
export function getMETByCategory(
  category: 'lifting' | 'running' | 'calisthenics' | 'sports' | 'flexibility',
  intensity: 'light' | 'moderate' | 'vigorous'
): METActivity | null {
  return MET_DATABASE.find(
    a => a.category === category && a.intensity === intensity
  ) || null;
}

/**
 * Calculate XP from workout based on effort
 * Base XP + Duration bonus + Intensity multiplier
 */
export function calculateWorkoutXP(
  met: number,
  durationMinutes: number,
  intensity: 'low' | 'medium' | 'high'
): number {
  // Base XP from MET value (higher MET = more effort = more XP)
  const baseXP = Math.floor(met * 2); // MET 3.5 = 7 XP, MET 11 = 22 XP
  
  // Duration bonus (1 XP per 5 minutes)
  const durationBonus = Math.floor(durationMinutes / 5);
  
  // Intensity multiplier
  const intensityMultipliers = {
    low: 1.0,
    medium: 1.5,
    high: 2.0
  };
  
  const totalXP = Math.floor(
    (baseXP + durationBonus) * intensityMultipliers[intensity]
  );
  
  return totalXP;
}

/**
 * Map old workout types to MET activities
 */
export function mapWorkoutTypeToMET(
  type: 'cardio' | 'strength' | 'flexibility' | 'sports' | 'hiit' | 'yoga',
  intensity: 'low' | 'medium' | 'high'
): METActivity {
  const intensityMap = {
    low: 'light' as const,
    medium: 'moderate' as const,
    high: 'vigorous' as const
  };
  
  const mappedIntensity = intensityMap[intensity];
  
  switch (type) {
    case 'strength':
      return getMETByCategory('lifting', mappedIntensity) || MET_DATABASE[1];
    case 'cardio':
    case 'hiit':
      return getMETByCategory('running', mappedIntensity) || MET_DATABASE[6];
    case 'flexibility':
    case 'yoga':
      return getMETByCategory('flexibility', mappedIntensity) || MET_DATABASE[15];
    case 'sports':
      return MET_DATABASE.find(a => a.id === 'basketball') || MET_DATABASE[12];
    default:
      return MET_DATABASE[1]; // Default to moderate lifting
  }
}

/**
 * Calculate active rest calories (lighter activities)
 */
export function calculateActiveRestCalories(
  type: 'walk' | 'mobility' | 'stretching' | 'yoga',
  bodyWeightLbs: number,
  durationMinutes: number
): number {
  const metValues = {
    walk: 3.3,
    mobility: 2.5,
    stretching: 2.3,
    yoga: 2.5
  };
  
  return calculateCaloriesBurned(metValues[type], bodyWeightLbs, durationMinutes);
}

/**
 * Get suggested MET activities by fitness level
 */
export function getSuggestedActivities(fitnessLevel: 'beginner' | 'intermediate' | 'advanced'): METActivity[] {
  switch (fitnessLevel) {
    case 'beginner':
      return MET_DATABASE.filter(a => a.intensity === 'light' || a.intensity === 'moderate');
    case 'intermediate':
      return MET_DATABASE.filter(a => a.intensity === 'moderate' || a.intensity === 'vigorous');
    case 'advanced':
      return MET_DATABASE;
    default:
      return MET_DATABASE;
  }
}
