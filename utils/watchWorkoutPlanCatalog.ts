export type WatchWorkoutPlanId =
  | 'runOutdoor'
  | 'runTreadmill'
  | 'lift'
  | 'walk'
  | 'cycle'
  | 'hike'
  | 'trackAndField'
  | 'swimPool'
  | 'swimOpenWater'
  | 'row'
  | 'elliptical'
  | 'stairStepper'
  | 'stairs'
  | 'stepTraining'
  | 'skating'
  | 'skiingCrossCountry'
  | 'skiingDownhill'
  | 'snowboarding'
  | 'paddling'
  | 'sailing'
  | 'surfing'
  | 'handCycling'
  | 'wheelchairWalkPace'
  | 'wheelchairRunPace'
  | 'strengthTraditional'
  | 'strengthFunctional'
  | 'coreTraining'
  | 'hiit'
  | 'mixedCardio'
  | 'crossTraining'
  | 'barre'
  | 'pilates'
  | 'yoga'
  | 'taiChi'
  | 'flexibility'
  | 'mindAndBody'
  | 'dance'
  | 'socialDance'
  | 'fitnessGaming'
  | 'waterFitness'
  | 'cooldown'
  | 'rolling'
  | 'archery'
  | 'badminton'
  | 'baseball'
  | 'basketball'
  | 'bowling'
  | 'boxing'
  | 'climbing'
  | 'cricket'
  | 'curling'
  | 'discSports'
  | 'equestrianSports'
  | 'fencing'
  | 'fishing'
  | 'football'
  | 'australianFootball'
  | 'golf'
  | 'gymnastics'
  | 'handball'
  | 'hockey'
  | 'hunting'
  | 'jumpRope'
  | 'kickboxing'
  | 'lacrosse'
  | 'martialArts'
  | 'multisport'
  | 'other'
  | 'pickleball'
  | 'play'
  | 'racquetball'
  | 'rugby'
  | 'soccer'
  | 'softball'
  | 'squash'
  | 'snowSports'
  | 'tableTennis'
  | 'tennis'
  | 'volleyball'
  | 'waterPolo'
  | 'waterSports'
  | 'wrestling';

export type WatchWorkoutPlanRow = {
  planId: WatchWorkoutPlanId;
  label: string;
  subtitle?: string;
  group: 'Distance & GPS' | 'HR & Calories' | 'Other';
};

// Phone-side mirror of the watch plan catalog. This is intentionally a lightweight list:
// it exists to drive UI for choosing/reordering watch carousel favorites.
export const WATCH_WORKOUT_PLANS: WatchWorkoutPlanRow[] = [
  { planId: 'runOutdoor', label: 'Run', subtitle: 'Outdoor', group: 'Distance & GPS' },
  { planId: 'runTreadmill', label: 'Run', subtitle: 'Treadmill', group: 'Distance & GPS' },
  { planId: 'lift', label: 'Lift', subtitle: 'Strength', group: 'HR & Calories' },

  { planId: 'walk', label: 'Walk', subtitle: 'Indoor/Outdoor', group: 'Distance & GPS' },
  { planId: 'cycle', label: 'Cycling', subtitle: 'Indoor/Outdoor', group: 'Distance & GPS' },
  { planId: 'hike', label: 'Hiking', group: 'Distance & GPS' },
  { planId: 'trackAndField', label: 'Track & Field', group: 'Distance & GPS' },
  { planId: 'swimPool', label: 'Swimming', subtitle: 'Pool', group: 'Distance & GPS' },
  { planId: 'swimOpenWater', label: 'Swimming', subtitle: 'Open Water', group: 'Distance & GPS' },
  { planId: 'row', label: 'Rowing', subtitle: 'Indoor/Outdoor', group: 'Distance & GPS' },
  { planId: 'elliptical', label: 'Elliptical', group: 'Distance & GPS' },
  { planId: 'stairStepper', label: 'Stair Stepper', group: 'Distance & GPS' },
  { planId: 'stairs', label: 'Stairs', subtitle: 'Indoor/Outdoor', group: 'Distance & GPS' },
  { planId: 'stepTraining', label: 'Step Training', group: 'Distance & GPS' },
  { planId: 'skating', label: 'Skating', subtitle: 'Indoor/Outdoor', group: 'Distance & GPS' },
  { planId: 'skiingCrossCountry', label: 'Cross-Country Skiing', group: 'Distance & GPS' },
  { planId: 'skiingDownhill', label: 'Downhill Skiing', group: 'Distance & GPS' },
  { planId: 'snowboarding', label: 'Snowboarding', group: 'Distance & GPS' },
  { planId: 'paddling', label: 'Paddling', group: 'Distance & GPS' },
  { planId: 'sailing', label: 'Sailing', group: 'Distance & GPS' },
  { planId: 'surfing', label: 'Surfing', group: 'Distance & GPS' },
  { planId: 'handCycling', label: 'Hand Cycling', subtitle: 'Indoor/Outdoor', group: 'Distance & GPS' },
  { planId: 'wheelchairWalkPace', label: 'Wheelchair', subtitle: 'Walking Pace', group: 'Distance & GPS' },
  { planId: 'wheelchairRunPace', label: 'Wheelchair', subtitle: 'Running Pace', group: 'Distance & GPS' },

  { planId: 'strengthTraditional', label: 'Strength', subtitle: 'Traditional', group: 'HR & Calories' },
  { planId: 'strengthFunctional', label: 'Strength', subtitle: 'Functional', group: 'HR & Calories' },
  { planId: 'coreTraining', label: 'Core', group: 'HR & Calories' },
  { planId: 'hiit', label: 'HIIT', group: 'HR & Calories' },
  { planId: 'mixedCardio', label: 'Mixed Cardio', group: 'HR & Calories' },
  { planId: 'crossTraining', label: 'Cross Training', group: 'HR & Calories' },
  { planId: 'barre', label: 'Barre', group: 'HR & Calories' },
  { planId: 'pilates', label: 'Pilates', group: 'HR & Calories' },
  { planId: 'yoga', label: 'Yoga', group: 'HR & Calories' },
  { planId: 'taiChi', label: 'Tai Chi', group: 'HR & Calories' },
  { planId: 'flexibility', label: 'Flexibility', group: 'HR & Calories' },
  { planId: 'mindAndBody', label: 'Mind & Body', group: 'HR & Calories' },
  { planId: 'dance', label: 'Dance', group: 'HR & Calories' },
  { planId: 'socialDance', label: 'Social Dance', group: 'HR & Calories' },
  { planId: 'fitnessGaming', label: 'Fitness Gaming', group: 'HR & Calories' },
  { planId: 'waterFitness', label: 'Water Fitness', group: 'HR & Calories' },
  { planId: 'cooldown', label: 'Cooldown', group: 'HR & Calories' },
  { planId: 'rolling', label: 'Rolling', group: 'HR & Calories' },

  { planId: 'archery', label: 'Archery', group: 'Other' },
  { planId: 'badminton', label: 'Badminton', group: 'Other' },
  { planId: 'baseball', label: 'Baseball', group: 'Other' },
  { planId: 'basketball', label: 'Basketball', group: 'Other' },
  { planId: 'bowling', label: 'Bowling', group: 'Other' },
  { planId: 'boxing', label: 'Boxing', group: 'Other' },
  { planId: 'climbing', label: 'Rock Climbing', subtitle: 'Indoor/Outdoor', group: 'Other' },
  { planId: 'cricket', label: 'Cricket', group: 'Other' },
  { planId: 'curling', label: 'Curling', group: 'Other' },
  { planId: 'discSports', label: 'Disc Sports', group: 'Other' },
  { planId: 'equestrianSports', label: 'Equestrian', group: 'Other' },
  { planId: 'fencing', label: 'Fencing', group: 'Other' },
  { planId: 'fishing', label: 'Fishing', group: 'Other' },
  { planId: 'football', label: 'Football', subtitle: 'American', group: 'Other' },
  { planId: 'australianFootball', label: 'Football', subtitle: 'Australian', group: 'Other' },
  { planId: 'golf', label: 'Golf', group: 'Other' },
  { planId: 'gymnastics', label: 'Gymnastics', group: 'Other' },
  { planId: 'handball', label: 'Handball', group: 'Other' },
  { planId: 'hockey', label: 'Hockey', subtitle: 'Indoor/Outdoor', group: 'Other' },
  { planId: 'hunting', label: 'Hunting', group: 'Other' },
  { planId: 'jumpRope', label: 'Jump Rope', group: 'Other' },
  { planId: 'kickboxing', label: 'Kickboxing', group: 'Other' },
  { planId: 'lacrosse', label: 'Lacrosse', group: 'Other' },
  { planId: 'martialArts', label: 'Martial Arts', group: 'Other' },
  { planId: 'multisport', label: 'Multisport', group: 'Other' },
  { planId: 'other', label: 'Other', group: 'Other' },
  { planId: 'pickleball', label: 'Pickleball', group: 'Other' },
  { planId: 'play', label: 'Play', group: 'Other' },
  { planId: 'racquetball', label: 'Racquetball', group: 'Other' },
  { planId: 'rugby', label: 'Rugby', group: 'Other' },
  { planId: 'soccer', label: 'Soccer', subtitle: 'Indoor/Outdoor', group: 'Other' },
  { planId: 'softball', label: 'Softball', group: 'Other' },
  { planId: 'squash', label: 'Squash', group: 'Other' },
  { planId: 'snowSports', label: 'Snow Sports', group: 'Other' },
  { planId: 'tableTennis', label: 'Table Tennis', group: 'Other' },
  { planId: 'tennis', label: 'Tennis', group: 'Other' },
  { planId: 'volleyball', label: 'Volleyball', group: 'Other' },
  { planId: 'waterPolo', label: 'Water Polo', group: 'Other' },
  { planId: 'waterSports', label: 'Water Sports', group: 'Other' },
  { planId: 'wrestling', label: 'Wrestling', group: 'Other' },
];

