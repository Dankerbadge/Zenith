// Performance & Error Handling Utilities
// Optimizations for production app

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { captureException } from './crashReporter';

const IS_DEV = typeof (globalThis as any).__DEV__ === 'boolean' ? Boolean((globalThis as any).__DEV__) : process.env.NODE_ENV === 'development';

/**
 * Batch AsyncStorage operations to reduce I/O
 */
export async function batchAsyncStorageGet(keys: string[]): Promise<{ [key: string]: any }> {
  try {
    const results = await AsyncStorage.multiGet(keys);
    const data: { [key: string]: any } = {};
    
    results.forEach(([key, value]) => {
      if (value) {
        try {
          data[key] = JSON.parse(value);
        } catch {
          data[key] = value;
        }
      }
    });
    
    return data;
  } catch (error) {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.error('Batch get error:', error);
    } else {
      void captureException(error, { feature: 'optimization', op: 'batch_async_storage_get' });
    }
    return {};
  }
}

/**
 * Batch AsyncStorage set operations
 */
export async function batchAsyncStorageSet(items: { key: string; value: any }[]): Promise<boolean> {
  try {
    const pairs: [string, string][] = items.map(({ key, value }) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value)
    ]);
    
    await AsyncStorage.multiSet(pairs);
    return true;
  } catch (error) {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.error('Batch set error:', error);
    } else {
      void captureException(error, { feature: 'optimization', op: 'batch_async_storage_set' });
    }
    return false;
  }
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Debounce function to prevent excessive calls
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function to limit call frequency
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Handle errors gracefully with user-friendly messages
 */
export function handleError(error: any, context: string): void {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.error(`Error in ${context}:`, error);
  } else {
    void captureException(error, { feature: 'optimization', op: 'handle_error', context });
  }
  
  // Log to analytics in production
  // Analytics.logError(context, error);
  
  const userMessage = getUserFriendlyError(error, context);
  
  Alert.alert(
    'Oops!',
    userMessage,
    [{ text: 'OK' }]
  );
}

/**
 * Convert technical errors to user-friendly messages
 */
function getUserFriendlyError(error: any, context: string): string {
  const errorMessage = error?.message || String(error);
  
  // Network errors
  if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
    return 'Network connection issue. Please check your internet and try again.';
  }
  
  // Storage errors
  if (errorMessage.includes('storage') || errorMessage.includes('quota')) {
    return 'Storage issue. Try clearing some app data or restarting the app.';
  }
  
  // Permission errors
  if (errorMessage.includes('permission')) {
    return 'Permission required. Please check your app settings.';
  }
  
  // Location errors
  if (errorMessage.includes('location')) {
    return 'Location services unavailable. Please enable location permissions.';
  }
  
  // GPS errors
  if (errorMessage.includes('gps') || errorMessage.includes('positioning')) {
    return 'GPS signal lost. Make sure you have a clear view of the sky.';
  }
  
  // Purchase errors
  if (errorMessage.includes('purchase') || errorMessage.includes('billing')) {
    return 'Purchase failed. Please try again or contact support.';
  }
  
  // Context-specific messages
  switch (context) {
    case 'workout_logging':
      return 'Failed to save workout. Please try again.';
    case 'food_logging':
      return 'Failed to save food entry. Please try again.';
    case 'weight_logging':
      return 'Failed to save weight entry. Please try again.';
    case 'run_tracking':
      return 'Failed to save run data. Please try again.';
    case 'health_sync':
      return 'Failed to sync with Health app. Check your permissions.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Retry failed operations with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Max retries exceeded');
}

/**
 * Cache with TTL (Time To Live)
 */
const cache = new Map<string, { value: any; expiry: number }>();

export function cacheSet(key: string, value: any, ttlMs: number = 300000): void {
  cache.set(key, {
    value,
    expiry: Date.now() + ttlMs
  });
}

export function cacheGet<T>(key: string): T | null {
  const cached = cache.get(key);
  
  if (!cached) return null;
  
  if (Date.now() > cached.expiry) {
    cache.delete(key);
    return null;
  }
  
  return cached.value as T;
}

export function cacheClear(): void {
  cache.clear();
}

/**
 * Validate data before saving
 */
export function validateWorkoutData(workout: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!workout.type) errors.push('Workout type is required');
  if (!workout.duration || workout.duration <= 0) errors.push('Duration must be greater than 0');
  if (!workout.calories || workout.calories < 0) errors.push('Calories must be 0 or greater');
  if (workout.intensity && !['low', 'medium', 'high'].includes(workout.intensity)) {
    errors.push('Invalid intensity level');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateFoodData(food: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!food.name || food.name.trim().length === 0) errors.push('Food name is required');
  if (!food.calories || food.calories <= 0) errors.push('Calories must be greater than 0');
  if (food.protein && food.protein < 0) errors.push('Protein cannot be negative');
  if (food.carbs && food.carbs < 0) errors.push('Carbs cannot be negative');
  if (food.fats && food.fats < 0) errors.push('Fats cannot be negative');
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateWeightData(weight: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!weight.weight || weight.weight <= 0) errors.push('Weight must be greater than 0');
  if (weight.weight > 1000) errors.push('Weight value seems unrealistic');
  if (weight.weight < 50) errors.push('Weight value seems too low');
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Clean old data to free up storage
 */
export async function cleanOldData(daysToKeep: number = 365): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const dailyLogKeys = keys.filter(k => k.startsWith('dailyLog_'));
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    const keysToDelete = dailyLogKeys.filter(key => {
      const dateStr = key.replace('dailyLog_', '');
      return dateStr < cutoffStr;
    });
    
    if (keysToDelete.length > 0) {
      await AsyncStorage.multiRemove(keysToDelete);
      if (IS_DEV) {
        // eslint-disable-next-line no-console
        console.log(`Cleaned ${keysToDelete.length} old daily logs`);
      }
    }
  } catch (error) {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.error('Error cleaning old data:', error);
    } else {
      void captureException(error, { feature: 'optimization', op: 'clean_old_data' });
    }
  }
}

/**
 * Get app size and storage usage
 */
export async function getStorageInfo(): Promise<{
  totalKeys: number;
  estimatedSize: number;
  dailyLogs: number;
}> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const dailyLogKeys = keys.filter(k => k.startsWith('dailyLog_'));
    
    // Rough estimate: each key + value pair is ~1-5KB
    const estimatedSize = keys.length * 2.5; // KB
    
    return {
      totalKeys: keys.length,
      estimatedSize: Math.round(estimatedSize),
      dailyLogs: dailyLogKeys.length
    };
  } catch {
    return {
      totalKeys: 0,
      estimatedSize: 0,
      dailyLogs: 0
    };
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Check if app needs update (version comparison)
 */
export function compareVersions(current: string, required: string): boolean {
  const currentParts = current.split('.').map(Number);
  const requiredParts = required.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    if (currentParts[i] > requiredParts[i]) return true;
    if (currentParts[i] < requiredParts[i]) return false;
  }
  
  return true; // Equal versions
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .slice(0, 200); // Limit length
}

/**
 * Log only in development
 */
export function devLog(...args: any[]): void {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

/**
 * Performance monitoring wrapper
 */
export async function measurePerformance<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  const start = Date.now();
  
  try {
    const result = await operation();
    const duration = Date.now() - start;
    
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.log(`⚡ ${label}: ${duration}ms`);
    }
    
    // Log slow operations
    if (duration > 1000) {
      // Dev-only: slow op detection is useful while tuning but becomes noise in production.
      if (IS_DEV) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ Slow operation detected: ${label} took ${duration}ms`);
      }
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.error(`❌ ${label} failed after ${duration}ms:`, error);
    } else {
      void captureException(error, { feature: 'optimization', op: 'measure_performance', label, durationMs: duration });
    }
    throw error;
  }
}
