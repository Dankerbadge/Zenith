// Social Sharing Service
// Generate and share beautiful workout summaries

import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { captureRef } from 'react-native-view-shot';
import { Alert } from 'react-native';
import { captureException } from './crashReporter';

function isUserCancelledShare(error: unknown) {
  const message = String((error as any)?.message || '').toLowerCase();
  const code = String((error as any)?.code || '').toLowerCase();
  // Expo Sharing implementations vary; treat explicit cancellation as non-error noise.
  return message.includes('cancel') || code.includes('cancel');
}

/**
 * Share workout summary
 */
export async function shareWorkout(workout: {
  type: string;
  duration: number;
  calories: number;
  date: string;
}) {
  try {
    // Create shareable text
    const text = `💪 Workout Complete!

Type: ${workout.type}
Duration: ${Math.floor(workout.duration / 60)} min
Calories: ${workout.calories} cal

Tracked with Zenith 🏔️
#ZenithFitness #WorkoutComplete`;

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync('', {
        mimeType: 'text/plain',
        dialogTitle: 'Share Your Workout',
        UTI: 'public.text',
      });
    } else {
      Alert.alert('Sharing not available', 'Cannot share on this device');
    }
    
    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Share workout error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'share_workout' });
    }
    return false;
  }
}

/**
 * Share run summary with stats
 */
export async function shareRun(run: {
  distance: number;
  duration: number;
  pace: number;
  calories: number;
}) {
  try {
    const minutes = Math.floor(run.duration / 60);
    const seconds = run.duration % 60;
    
    const text = `🏃 Run Complete!

Distance: ${run.distance.toFixed(2)} mi
Time: ${minutes}:${seconds.toString().padStart(2, '0')}
Pace: ${run.pace.toFixed(1)} min/mi
Calories: ${run.calories} cal

Tracked with Zenith 🏔️
#ZenithFitness #Running`;

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync('', {
        mimeType: 'text/plain',
        dialogTitle: 'Share Your Run',
      });
    }
    
    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Share run error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'share_run' });
    }
    return false;
  }
}

/**
 * Share achievement unlock
 */
export async function shareAchievement(achievement: {
  name: string;
  icon: string;
  description: string;
  tier: string;
}) {
  try {
    const text = `${achievement.icon} Achievement Unlocked!

"${achievement.name}"
${achievement.description}

Tier: ${achievement.tier}

Tracked with Zenith 🏔️
#ZenithFitness #Achievement`;

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync('', {
        mimeType: 'text/plain',
        dialogTitle: 'Share Your Achievement',
      });
    }
    
    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Share achievement error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'share_achievement' });
    }
    return false;
  }
}

/**
 * Share rank up
 */
export async function shareRankUp(rank: {
  name: string;
  icon: string;
  totalXP: number;
  winningDays: number;
}) {
  try {
    const text = `${rank.icon} RANK UP!

I just reached ${rank.name}!

Total XP: ${rank.totalXP.toLocaleString()}
Winning Days: ${rank.winningDays}

Tracked with Zenith 🏔️
#ZenithFitness #RankUp`;

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync('', {
        mimeType: 'text/plain',
        dialogTitle: 'Share Your Rank',
      });
    }
    
    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Share rank error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'share_rank' });
    }
    return false;
  }
}

/**
 * Share weekly stats
 */
export async function shareWeeklyStats(stats: {
  workouts: number;
  winningDays: number;
  calories: number;
  xp: number;
}) {
  try {
    const text = `📊 This Week in Zenith

Workouts: ${stats.workouts}
Winning Days: ${stats.winningDays}
Calories Burned: ${stats.calories.toLocaleString()}
XP Earned: ${stats.xp}

Keep crushing it! 💪
#ZenithFitness #WeeklyStats`;

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync('', {
        mimeType: 'text/plain',
        dialogTitle: 'Share Your Stats',
      });
    }
    
    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Share stats error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'share_weekly_stats' });
    }
    return false;
  }
}

/**
 * Capture component as image and share
 */
export async function captureAndShare(
  viewRef: any,
  title: string = 'Share from Zenith'
): Promise<boolean> {
  try {
    // Capture the view as image
    const uri = await captureRef(viewRef, {
      format: 'png',
      quality: 1.0,
    });

    // Share the image
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: title,
      });
    }

    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Capture and share error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'capture_and_share' });
    }
    Alert.alert('Error', 'Failed to share image');
    return false;
  }
}

/**
 * Export data as CSV
 */
export async function exportWorkoutsAsCSV(workouts: any[]): Promise<boolean> {
  try {
    // Create CSV content
    let csv = 'Date,Type,Duration (min),Calories,Intensity\n';
    
    workouts.forEach(workout => {
      csv += `${workout.date},${workout.type},${Math.floor(workout.duration / 60)},${workout.calories},${workout.intensity}\n`;
    });

    // Save to file
    const fileName = `zenith_workouts_${new Date().toISOString().split('T')[0]}.csv`;
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;
    
    await FileSystem.writeAsStringAsync(fileUri, csv);

    // Share the file
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export Workouts',
      });
    }

    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Export CSV error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'export_workouts_csv' });
    }
    Alert.alert('Error', 'Failed to export data');
    return false;
  }
}

/**
 * Export food logs as CSV
 */
export async function exportFoodLogsAsCSV(foodLogs: any[]): Promise<boolean> {
  try {
    let csv = 'Date,Meal,Food,Calories,Protein,Carbs,Fats\n';
    
    foodLogs.forEach(entry => {
      csv += `${entry.date},${entry.meal},${entry.name},${entry.calories},${entry.protein},${entry.carbs},${entry.fats}\n`;
    });

    const fileName = `zenith_nutrition_${new Date().toISOString().split('T')[0]}.csv`;
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;
    
    await FileSystem.writeAsStringAsync(fileUri, csv);

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export Nutrition',
      });
    }

    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Export food logs error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'export_food_csv' });
    }
    return false;
  }
}

/**
 * Generate and share stats card (image)
 */
export async function shareStatsCard(stats: {
  totalWorkouts: number;
  totalXP: number;
  currentRank: string;
  rankIcon: string;
  winningDays: number;
}): Promise<boolean> {
  try {
    const text = `${stats.rankIcon} ${stats.currentRank}

Total Workouts: ${stats.totalWorkouts}
Total XP: ${stats.totalXP.toLocaleString()}
Winning Days: ${stats.winningDays}

Join me on Zenith! 🏔️
#ZenithFitness`;

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync('', {
        mimeType: 'text/plain',
        dialogTitle: 'Share Your Progress',
      });
    }

    return true;
  } catch (error) {
    if (isUserCancelledShare(error)) return false;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Share stats card error:', error);
    } else {
      void captureException(error, { feature: 'sharing', op: 'share_stats_card' });
    }
    return false;
  }
}
