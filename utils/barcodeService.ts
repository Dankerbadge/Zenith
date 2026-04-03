// Barcode Scanner Service
// Scan food barcodes and lookup nutrition info

import { Camera } from 'expo-camera';
import { Alert } from 'react-native';
import { captureException } from './crashReporter';

export interface ScannedFood {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  servingSize: string;
  barcode: string;
}

/**
 * Request camera permissions for barcode scanning
 */
export async function requestBarcodeScannerPermissions(): Promise<boolean> {
  try {
    const { status } = await Camera.requestCameraPermissionsAsync();
    
    if (status !== 'granted') {
      Alert.alert(
        'Camera Permission Required',
        'Please enable camera access in Settings to scan barcodes.'
      );
      return false;
    }
    
    return true;
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Permission error:', error);
    } else {
      void captureException(error, { feature: 'barcode', op: 'request_permission' });
    }
    return false;
  }
}

/**
 * Lookup food by barcode using Open Food Facts API
 */
export async function lookupFoodByBarcode(barcode: string): Promise<ScannedFood | null> {
  try {
    // Open Food Facts API (free, no auth required)
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
    );
    
    const data = await response.json();
    
    if (data.status === 0) {
      // Product not found
      return null;
    }
    
    const product = data.product;
    
    // Extract nutrition info per 100g
    const nutriments = product.nutriments || {};
    
    return {
      name: product.product_name || 'Unknown Product',
      calories: Math.round(nutriments.energy_value || nutriments['energy-kcal'] || 0),
      protein: Math.round(nutriments.proteins || 0),
      carbs: Math.round(nutriments.carbohydrates || 0),
      fats: Math.round(nutriments.fat || 0),
      servingSize: product.serving_size || '100g',
      barcode: barcode
    };
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('Barcode lookup error:', error);
    } else {
      void captureException(error, { feature: 'barcode', op: 'lookup_open_food_facts' });
    }
    return null;
  }
}

/**
 * Fallback: USDA FoodData Central API (requires API key)
 * Sign up at: https://fdc.nal.usda.gov/api-key-signup.html
 */
export async function lookupFoodByUPC(
  upc: string,
  apiKey?: string
): Promise<ScannedFood | null> {
  if (!apiKey) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('USDA API key not provided, using Open Food Facts only');
    }
    return lookupFoodByBarcode(upc);
  }
  
  try {
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${upc}&api_key=${apiKey}`
    );
    
    const data = await response.json();
    
    if (!data.foods || data.foods.length === 0) {
      // Fallback to Open Food Facts
      return lookupFoodByBarcode(upc);
    }
    
    const food = data.foods[0];
    const nutrients = food.foodNutrients || [];
    
    // Extract nutrients
    const getNutrient = (name: string) => {
      const nutrient = nutrients.find((n: any) => 
        n.nutrientName.toLowerCase().includes(name.toLowerCase())
      );
      return nutrient ? Math.round(nutrient.value) : 0;
    };
    
    return {
      name: food.description || 'Unknown Product',
      calories: getNutrient('energy'),
      protein: getNutrient('protein'),
      carbs: getNutrient('carbohydrate'),
      fats: getNutrient('fat'),
      servingSize: '100g',
      barcode: upc
    };
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('USDA lookup error:', error);
    } else {
      void captureException(error, { feature: 'barcode', op: 'lookup_usda' });
    }
    return lookupFoodByBarcode(upc);
  }
}

/**
 * Manual barcode entry (for when camera doesn't work)
 */
export async function manualBarcodeEntry(barcode: string): Promise<ScannedFood | null> {
  // No mock barcodes: only return real lookup results.
  return await lookupFoodByBarcode(barcode);
}

/**
 * Validate barcode format
 */
export function isValidBarcode(barcode: string): boolean {
  // UPC-A: 12 digits
  // EAN-13: 13 digits
  // EAN-8: 8 digits
  const validLengths = [8, 12, 13];
  return validLengths.includes(barcode.length) && /^\d+$/.test(barcode);
}

/**
 * Format barcode for display
 */
export function formatBarcode(barcode: string): string {
  if (barcode.length === 12) {
    // UPC-A: 0-12345-67890-1
    return barcode.replace(/(\d{1})(\d{5})(\d{5})(\d{1})/, '$1-$2-$3-$4');
  } else if (barcode.length === 13) {
    // EAN-13: 1-234567-890123
    return barcode.replace(/(\d{1})(\d{6})(\d{6})/, '$1-$2-$3');
  }
  return barcode;
}
