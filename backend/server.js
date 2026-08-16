require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AUTH_SECRET_FILE = path.join(DATA_DIR, '.auth-secret');
const AUTH_SECRET = process.env.AUTH_SECRET || getOrCreateAuthSecret();

// Initialize data files
if (!fs.existsSync(PRODUCTS_FILE)) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(getDefaultProducts(), null, 2));
}
if (!fs.existsSync(PROFILES_FILE)) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

function getOrCreateAuthSecret() {
    if (fs.existsSync(AUTH_SECRET_FILE)) return fs.readFileSync(AUTH_SECRET_FILE, 'utf8').trim();
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(AUTH_SECRET_FILE, secret, { mode: 0o600 });
    return secret;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function passwordMatches(password, storedHash) {
    const [salt, savedHash] = storedHash.split(':');
    if (!salt || !savedHash) return false;
    const calculatedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(savedHash, 'hex'), Buffer.from(calculatedHash, 'hex'));
}

function toBase64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function signToken(payload) {
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
}

function createToken(user) {
    return signToken({ sub: user.id, email: user.email, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
}

function getTokenPayload(token) {
    const [encodedPayload, receivedSignature] = String(token || '').split('.');
    if (!encodedPayload || !receivedSignature) return null;
    const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(encodedPayload).digest('base64url');
    const receivedBuffer = Buffer.from(receivedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
    try {
        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
        return payload.exp > Date.now() ? payload : null;
    } catch {
        return null;
    }
}

function requireAuth(req, res, next) {
    const payload = getTokenPayload(req.headers.authorization?.replace(/^Bearer\s+/i, ''));
    if (!payload) return res.status(401).json({ error: 'Please sign in to use your health profile.' });
    const user = readJson(USERS_FILE).find(candidate => candidate.id === payload.sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user;
    next();
}

function getDefaultProducts() {
    return [
        {
            barcode: "8901234567890",
            name: "Chocolate Cream Biscuits",
            brand: "CrunchyDelight",
            category: "Biscuits",
            ingredients: [
                { name: "Wheat Flour", type: "base" },
                { name: "Sugar", type: "additive", concern: "high" },
                { name: "Palm Oil", type: "fat", concern: "moderate" },
                { name: "Cocoa Powder", type: "flavor" },
                { name: "Milk Solids", type: "dairy" },
                { name: "INS 211 (Sodium Benzoate)", type: "preservative", concern: "moderate" },
                { name: "Salt", type: "additive", concern: "moderate" },
                { name: "Emulsifiers (INS 322)", type: "additive", concern: "low" }
            ],
            nutritionPer100g: {
                energy: 480,
                protein: 6,
                carbohydrates: 68,
                sugars: 32,
                fat: 22,
                saturatedFat: 12,
                transFat: 0.2,
                sodium: 580,
                fiber: 2,
                wholeGrain: false
            },
            processingLevel: "ultra-processed",
            additivesCount: 3
        },
        {
            barcode: "8901234567891",
            name: "Whole Wheat Oats",
            brand: "Nature's Best",
            category: "Breakfast Cereals",
            ingredients: [
                { name: "Whole Grain Oats", type: "whole_grain" },
                { name: "Wheat Bran", type: "fiber" },
                { name: "Honey", type: "sweetener", concern: "low" }
            ],
            nutritionPer100g: {
                energy: 380,
                protein: 12,
                carbohydrates: 65,
                sugars: 8,
                fat: 6,
                saturatedFat: 1,
                transFat: 0,
                sodium: 120,
                fiber: 10,
                wholeGrain: true
            },
            processingLevel: "minimally-processed",
            additivesCount: 0
        },
        {
            barcode: "8901234567892",
            name: "Instant Noodles Masala",
            brand: "QuickBite",
            category: "Instant Food",
            ingredients: [
                { name: "Refined Wheat Flour", type: "base" },
                { name: "Palm Oil", type: "fat", concern: "moderate" },
                { name: "Salt", type: "additive", concern: "high" },
                { name: "MSG (INS 621)", type: "flavor_enhancer", concern: "moderate" },
                { name: "INS 319 (TBHQ)", type: "preservative", concern: "high" },
                { name: "Artificial Colors", type: "additive", concern: "moderate" },
                { name: "Dehydrated Vegetables", type: "vegetable" }
            ],
            nutritionPer100g: {
                energy: 450,
                protein: 8,
                carbohydrates: 60,
                sugars: 2,
                fat: 20,
                saturatedFat: 10,
                transFat: 0.5,
                sodium: 2000,
                fiber: 1,
                wholeGrain: false
            },
            processingLevel: "ultra-processed",
            additivesCount: 5
        }
    ];
}

// ============ AI ANALYSIS ENGINE ============

function analyzeProduct(product, healthProfile = null) {
    const n = product.nutritionPer100g;
    const analysis = {
        recommendation: '',
        canConsume: null,
        verdict: 'unknown',
        frequency: '',
        reason: '',
        ingredientAnalysis: [],
        quantityAnalysis: {},
        qualityAssessment: {},
        hazardAnalysis: [],
        processingLevel: product.processingLevel,
        additivesCount: product.additivesCount
    };

    // Quantity Analysis
    analysis.quantityAnalysis = {
        sugar: classifyLevel(n.sugars, [2.5, 5, 10], 'g'),
        sodium: classifyLevel(n.sodium, [120, 400, 600], 'mg'),
        saturatedFat: classifyLevel(n.saturatedFat, [1.5, 5, 10], 'g'),
        transFat: classifyLevel(n.transFat, [0, 0.1, 0.2], 'g'),
        calories: classifyLevel(n.energy, [150, 300, 400], 'kcal'),
        fiber: classifyLevel(n.fiber, [1.5, 3, 6], 'g', true)
    };

    // Ingredient Analysis
    analysis.ingredientAnalysis = product.ingredients.map(ing => ({
        name: ing.name,
        type: ing.type,
        concern: ing.concern || 'none',
        description: getIngredientDescription(ing.name, ing.type)
    }));

    // Quality Assessment
    const dataQuality = assessDataQuality(n, product);
    const qualityScore = calculateQualityScore(n, product, dataQuality);
    analysis.qualityAssessment = {
        score: qualityScore,
        dataConfidence: dataQuality.confidence,
        availableData: dataQuality.availableFields,
        totalDataFields: dataQuality.totalFields,
        hasWholeGrains: n.wholeGrain,
        fiberContent: analysis.quantityAnalysis.fiber.level,
        proteinContent: classifyLevel(n.protein, [5, 10, 20], 'g', true).level,
        vitaminMineralContribution: 'Not assessed from barcode data',
        processingLevel: product.processingLevel
    };

    // Hazard Analysis
    analysis.hazardAnalysis = identifyHazards(n, product, healthProfile, dataQuality);

    // Final Recommendation
    const rec = generateRecommendation(qualityScore, analysis.hazardAnalysis, dataQuality, healthProfile);
    analysis.recommendation = rec.text;
    analysis.canConsume = rec.canConsume;
    analysis.verdict = rec.verdict;
    analysis.frequency = rec.frequency;
    analysis.reason = rec.reason;

    return analysis;
}

function classifyLevel(value, thresholds, unit, higherIsBetter = false) {
    if (!isKnown(value)) return { value: null, unit, level: 'Not declared', known: false };
    let level;
    if (higherIsBetter) {
        if (value >= thresholds[2]) level = 'High';
        else if (value >= thresholds[1]) level = 'Moderate';
        else if (value >= thresholds[0]) level = 'Low';
        else level = 'Very Low';
    } else {
        if (value <= thresholds[0]) level = 'Low';
        else if (value <= thresholds[1]) level = 'Moderate';
        else if (value <= thresholds[2]) level = 'High';
        else level = 'Very High';
    }
    return { value, unit, level, known: true };
}

function isKnown(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function assessDataQuality(nutrition, product) {
    const requiredFields = ['energy', 'sugars', 'saturatedFat', 'sodium'];
    const trackedFields = [...requiredFields, 'protein', 'fiber', 'transFat'];
    const availableFields = trackedFields.filter(field => isKnown(nutrition[field])).length;
    const hasIngredientList = product.ingredients.length > 0;
    const hasProcessingLevel = product.processingLevel !== 'unknown';
    const completeness = (availableFields + Number(hasIngredientList) + Number(hasProcessingLevel)) / (trackedFields.length + 2);

    return {
        canRate: requiredFields.every(field => isKnown(nutrition[field])),
        availableFields,
        totalFields: trackedFields.length,
        confidence: completeness >= 0.9 ? 'High' : completeness >= 0.65 ? 'Medium' : 'Low',
        hasIngredientList,
        hasProcessingLevel
    };
}

function getIngredientDescription(name, type) {
    const descriptions = {
        'Sugar': 'Increases sweetness but excessive intake may contribute to obesity and diabetes.',
        'Palm Oil': 'Commonly used in processed foods; high intake of saturated fats should be limited.',
        'INS 211 (Sodium Benzoate)': 'A food preservative approved for regulated use but commonly found in highly processed foods.',
        'MSG (INS 621)': 'Flavor enhancer that may cause sensitivity in some individuals.',
        'INS 319 (TBHQ)': 'Synthetic antioxidant preservative; limit intake of foods containing this.',
        'Whole Grain Oats': 'Rich in fiber and nutrients; supports digestive health.',
        'Wheat Bran': 'Excellent source of dietary fiber.'
    };
    return descriptions[name] || `Common ${type.replace('_', ' ')} ingredient.`;
}

function calculateQualityScore(nutrition, product, dataQuality) {
    if (!dataQuality.canRate) return null;

    const sugarEnergyPercent = nutrition.sugars * 4 / nutrition.energy * 100;
    const saturatedFatEnergyPercent = nutrition.saturatedFat * 9 / nutrition.energy * 100;
    const sodiumDensity = nutrition.sodium / nutrition.energy;
    let score = 100;

    if (sugarEnergyPercent >= 10) score -= 35;
    else if (sugarEnergyPercent >= 5) score -= 20;
    else if (nutrition.sugars > 5) score -= 10;
    if (saturatedFatEnergyPercent >= 10) score -= 20;
    else if (saturatedFatEnergyPercent >= 5) score -= 10;
    if (sodiumDensity >= 1) score -= 20;
    else if (sodiumDensity >= 0.5) score -= 10;
    if (isKnown(nutrition.transFat) && nutrition.transFat > 0) score -= 20;
    if (product.processingLevel === 'ultra-processed') score -= 15;
    if (isKnown(product.additivesCount) && product.additivesCount > 3) score -= 10;
    if (nutrition.wholeGrain) score += 10;
    if (isKnown(nutrition.fiber) && nutrition.fiber >= 6) score += 10;
    if (isKnown(nutrition.protein) && nutrition.protein >= 10) score += 5;

    return Math.max(0, Math.min(100, Math.round(score)));
}

function identifyHazards(nutrition, product, healthProfile, dataQuality) {
    const hazards = [];
    if (!dataQuality.canRate) hazards.push({ type: 'missing_nutrition', severity: 'unknown', description: 'Key nutrition values are missing, so a reliable nutrition rating cannot be calculated.' });
    if (!dataQuality.hasIngredientList) hazards.push({ type: 'missing_ingredients', severity: 'unknown', description: 'Ingredients are not available, so additive and allergen checks are incomplete.' });
    if (!dataQuality.hasProcessingLevel) hazards.push({ type: 'missing_processing_level', severity: 'unknown', description: 'Processing level is not available in this barcode record.' });

    const hasEnergy = isKnown(nutrition.energy) && nutrition.energy > 0;
    if (hasEnergy && isKnown(nutrition.sugars)) {
        const sugarEnergyPercent = nutrition.sugars * 4 / nutrition.energy * 100;
        if (sugarEnergyPercent >= 10) hazards.push({ type: 'high_sugar', severity: 'high', description: `Total sugars provide ${Math.round(sugarEnergyPercent)}% of this product's energy. Limit frequent intake, especially for diabetes management.` });
        else if (sugarEnergyPercent >= 5) hazards.push({ type: 'moderate_sugar', severity: 'moderate', description: `Total sugars provide ${Math.round(sugarEnergyPercent)}% of this product's energy.` });
    }
    if (hasEnergy && isKnown(nutrition.sodium)) {
        const sodiumDensity = nutrition.sodium / nutrition.energy;
        if (sodiumDensity >= 1) hazards.push({ type: 'high_sodium', severity: 'high', description: 'Sodium density is high for its energy content. Limit frequent intake, especially with hypertension.' });
        else if (sodiumDensity >= 0.5) hazards.push({ type: 'moderate_sodium', severity: 'moderate', description: 'Sodium density is moderate for its energy content.' });
    }
    if (hasEnergy && isKnown(nutrition.saturatedFat)) {
        const saturatedFatEnergyPercent = nutrition.saturatedFat * 9 / nutrition.energy * 100;
        if (saturatedFatEnergyPercent >= 10) hazards.push({ type: 'high_saturated_fat', severity: 'high', description: `Saturated fat provides ${Math.round(saturatedFatEnergyPercent)}% of this product's energy.` });
    }
    if (isKnown(nutrition.transFat) && nutrition.transFat > 0) hazards.push({ type: 'trans_fat', severity: 'high', description: 'Reported trans fat should be minimized as part of a healthy diet.' });
    if (isKnown(product.additivesCount) && product.additivesCount > 3) hazards.push({ type: 'additives', severity: 'moderate', description: `Contains ${product.additivesCount} food additives. Frequent consumption of additive-rich foods is not recommended.` });
    if (product.processingLevel === 'ultra-processed') hazards.push({ type: 'ultra_processed', severity: 'moderate', description: 'Ultra-processed foods are linked to poorer metabolic health when consumed regularly.' });

    if (healthProfile) {
        if (healthProfile.diabetes && isKnown(nutrition.sugars) && nutrition.sugars > 5) hazards.push({ type: 'personal_diabetes', severity: 'high', description: 'This sugar level is not recommended for diabetes management.' });
        if (healthProfile.hypertension && isKnown(nutrition.sodium) && nutrition.sodium > 200) hazards.push({ type: 'personal_hypertension', severity: 'high', description: 'This sodium level may exceed your personalised limit.' });
        if (healthProfile.heartDisease && ((isKnown(nutrition.saturatedFat) && nutrition.saturatedFat > 2) || (isKnown(nutrition.transFat) && nutrition.transFat > 0))) hazards.push({ type: 'personal_heart', severity: 'high', description: 'This fat composition is not ideal for your heart-health profile.' });
    }
    return hazards;
}

function generateRecommendation(score, hazards, dataQuality, healthProfile) {
    const highSeverityHazards = hazards.filter(h => h.severity === 'high');
    const moderateHazards = hazards.filter(h => h.severity === 'moderate');

    if (highSeverityHazards.length > 0) {
        return { verdict: 'limit', canConsume: false, text: 'LIMIT', frequency: 'Avoid frequent intake', reason: highSeverityHazards[0].description };
    }
    if (!dataQuality.canRate || dataQuality.confidence === 'Low') {
        return { verdict: 'unknown', canConsume: null, text: 'INSUFFICIENT DATA', frequency: 'Check the package label', reason: 'This barcode record is incomplete. Do not rely on this result alone.' };
    }
    if (moderateHazards.length > 0 || score < 70 || dataQuality.confidence !== 'High') {
        return { verdict: 'moderate', canConsume: true, text: 'MODERATE', frequency: 'Occasional intake', reason: moderateHazards[0]?.description || 'The record has moderate concerns or incomplete data.' };
    }
    return { verdict: 'good', canConsume: true, text: 'BETTER CHOICE', frequency: 'Fits a balanced diet', reason: 'No high-risk nutrition flags were found in a complete barcode record.' };
}

function generateLegacyRecommendation(score, hazards, nutrition, product, healthProfile) {
    const highSeverityHazards = hazards.filter(h => h.severity === 'high');
    const hasCriticalIssue = highSeverityHazards.length > 0 || score < 30;
    const hasModerateIssue = hazards.filter(h => h.severity === 'moderate').length > 2 || score < 50;

    let rec = {};

    if (hasCriticalIssue) {
        rec.canConsume = false;
        rec.text = 'NO – Not recommended for regular consumption.';
        rec.frequency = 'Avoid regular consumption';
        rec.reason = highSeverityHazards[0]?.description || 'Nutritional profile indicates significant health concerns.';
    } else if (hasModerateIssue) {
        rec.canConsume = true;
        rec.text = 'YES – You can consume this product.';
        rec.frequency = 'Consume only once per week';
        rec.reason = 'Contains ingredients that should be consumed in moderation.';
    } else if (score >= 70) {
        rec.canConsume = true;
        rec.text = 'YES – You can consume this product.';
        rec.frequency = 'Safe for daily consumption';
        rec.reason = 'Good nutritional profile with wholesome ingredients.';
    } else {
        rec.canConsume = true;
        rec.text = 'YES – You can consume this product.';
        rec.frequency = 'Consume 3–4 times per week';
        rec.reason = 'Moderate nutritional value; balance with other healthy foods.';
    }

    // Override for personalized conditions
    if (healthProfile && highSeverityHazards.some(h => h.type.startsWith('personal_'))) {
        rec.canConsume = false;
        rec.text = 'NO – Not recommended based on your health profile.';
        rec.frequency = 'Avoid or consult your doctor';
        rec.reason = highSeverityHazards.find(h => h.type.startsWith('personal_'))?.description || rec.reason;
    }

    return rec;
}

function getIngredientConcern(name) {
    const normalized = name.toLowerCase();
    if (/sugar|glucose|syrup|salt|sodium|tbhq|trans fat/.test(normalized)) return 'high';
    if (/palm oil|preservative|colour|color|emulsifier|flavour|flavor|additive/.test(normalized)) return 'moderate';
    return 'none';
}

function getIngredientType(name) {
    const normalized = name.toLowerCase();
    if (/whole grain|whole wheat|oat|millet|brown rice/.test(normalized)) return 'whole_grain';
    if (/oil|fat|ghee|butter/.test(normalized)) return 'fat';
    if (/preservative|benzoate|tbhq/.test(normalized)) return 'preservative';
    if (/flavour|flavor|msg/.test(normalized)) return 'flavor_enhancer';
    if (/milk|cheese|whey|butter/.test(normalized)) return 'dairy';
    return 'unknown';
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function mapOpenFoodFactsProduct(source, barcode) {
    const nutrients = source.nutriments || {};
    const sodiumPer100g = numberOrNull(nutrients.sodium_100g);
    const saltPer100g = numberOrNull(nutrients.salt_100g);
    const ingredients = (source.ingredients || []).map(ingredient => ingredient.text || ingredient.id)
        .filter(Boolean)
        .map(name => ({ name, type: getIngredientType(name), concern: getIngredientConcern(name) }));
    const ingredientText = source.ingredients_text || source.ingredients_text_en || '';
    const fallbackIngredients = ingredientText.split(',').map(item => item.trim()).filter(Boolean)
        .map(name => ({ name, type: getIngredientType(name), concern: getIngredientConcern(name) }));
    const novaGroup = numberOrNull(source.nova_group);

    return {
        barcode,
        name: source.product_name || source.product_name_en || 'Unnamed product',
        brand: source.brands || 'Unknown brand',
        category: source.categories || 'Uncategorized',
        imageUrl: source.image_front_url || source.image_url || null,
        ingredients: ingredients.length ? ingredients : fallbackIngredients,
        nutritionPer100g: {
            energy: numberOrNull(nutrients['energy-kcal_100g'] ?? nutrients.energy_kcal_100g ?? (isKnown(nutrients.energy_100g) ? nutrients.energy_100g / 4.184 : null)),
            protein: numberOrNull(nutrients.proteins_100g),
            carbohydrates: numberOrNull(nutrients.carbohydrates_100g),
            sugars: numberOrNull(nutrients.sugars_100g),
            fat: numberOrNull(nutrients.fat_100g),
            saturatedFat: numberOrNull(nutrients['saturated-fat_100g']),
            transFat: numberOrNull(nutrients.trans_fat_100g),
            sodium: isKnown(sodiumPer100g) ? sodiumPer100g * 1000 : isKnown(saltPer100g) ? saltPer100g * 400 : null,
            fiber: numberOrNull(nutrients.fiber_100g),
            wholeGrain: /whole grain|whole wheat|wholemeal|oat|millet|brown rice/i.test(`${source.product_name || ''} ${ingredientText}`)
        },
        processingLevel: novaGroup >= 4 ? 'ultra-processed' : novaGroup === 3 ? 'processed' : novaGroup ? 'minimally-processed' : 'unknown',
        additivesCount: Array.isArray(source.additives_tags) ? source.additives_tags.length : null,
        dataSchemaVersion: 3,
        source: 'Open Food Facts',
        lastUpdated: new Date().toISOString()
    };
}

function sanitizeLegacyCatalogueProduct(product) {
    if (product.source !== 'Open Food Facts' || product.dataSchemaVersion >= 3) return product;
    const nutritionPer100g = Object.fromEntries(Object.entries(product.nutritionPer100g || {}).map(([name, value]) => [name, value === 0 ? null : value]));
    return {
        ...product,
        ingredients: [],
        nutritionPer100g,
        processingLevel: 'unknown',
        additivesCount: null,
        dataSchemaVersion: 3
    };
}

async function findProductByBarcode(barcode) {
    const products = readJson(PRODUCTS_FILE);
    const localProduct = products.find(product => product.barcode === barcode);
    if (localProduct && (localProduct.source !== 'Open Food Facts' || localProduct.dataSchemaVersion === 3)) return localProduct;

    let response;
    try {
        response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_en,brands,categories,ingredients,ingredients_text,ingredients_text_en,nutriments,nova_group,additives_tags,image_front_url,image_url`, {
            headers: {
                // Open Food Facts blocks requests with generic/unclear User-Agents.
                // Format they ask for: "AppName/Version (contact-or-site)".
                // Override via OPEN_FOOD_FACTS_USER_AGENT in .env if you deploy this.
                'User-Agent': process.env.OPEN_FOOD_FACTS_USER_AGENT || 'NutriScan-AI/1.0 (https://github.com/; prototype build for personal use)'
            }
        });
    } catch (networkError) {
        if (localProduct) return sanitizeLegacyCatalogueProduct(localProduct);
        throw new Error('The live product catalogue could not be reached. Check your internet connection and try again.');
    }

    if (!response.ok) {
        // Open Food Facts returned an error status (commonly 403 when it blocks a
        // request, e.g. from a shared-hosting IP it doesn't recognize, or 429 when
        // rate-limited). Fall back to a cached copy if we have one instead of failing.
        if (localProduct) return sanitizeLegacyCatalogueProduct(localProduct);
        if (response.status === 403) {
            throw new Error('Open Food Facts blocked this lookup (403). This barcode isn\'t in the local demo catalogue yet — try the "Ingredients" tab instead, or add this product via POST /api/products.');
        }
        if (response.status === 429) {
            throw new Error('Open Food Facts is rate-limiting lookups right now. Wait a moment and try again, or use the "Ingredients" tab.');
        }
        throw new Error(`The live product catalogue is temporarily unavailable (status ${response.status}).`);
    }

    const result = await response.json();
    if (result.status !== 1 || !result.product) return null;

    const product = mapOpenFoodFactsProduct(result.product, barcode);
    if (localProduct) products.splice(products.indexOf(localProduct), 1, product);
    else products.push(product);
    writeJson(PRODUCTS_FILE, products);
    return product;
}

function applyVerifiedLabel(product, verifiedLabel) {
    if (!verifiedLabel || typeof verifiedLabel !== 'object') return product;
    const nutrition = { ...product.nutritionPer100g };
    const fields = ['energy', 'protein', 'carbohydrates', 'sugars', 'fat', 'saturatedFat', 'transFat', 'sodium', 'fiber'];
    fields.forEach(field => {
        const value = numberOrNull(verifiedLabel[field]);
        if (value !== null && value >= 0) nutrition[field] = value;
    });

    const ingredientsText = String(verifiedLabel.ingredients || '').trim();
    const ingredients = ingredientsText ? ingredientsText.split(',').map(name => name.trim()).filter(Boolean).map(name => ({
        name,
        type: getIngredientType(name),
        concern: getIngredientConcern(name)
    })) : product.ingredients;
    const processingLevels = ['minimally-processed', 'processed', 'ultra-processed'];

    return {
        ...product,
        ingredients,
        nutritionPer100g: nutrition,
        processingLevel: processingLevels.includes(verifiedLabel.processingLevel) ? verifiedLabel.processingLevel : product.processingLevel,
        source: `${product.source || 'Barcode record'} + package label`
    };
}

// ============ API ROUTES ============

app.post('/api/auth/register', (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
        return res.status(400).json({ error: 'Enter your name, a valid email, and a password with at least 8 characters.' });
    }

    const users = readJson(USERS_FILE);
    if (users.some(user => user.email === email)) return res.status(409).json({ error: 'An account already exists for this email.' });

    const user = { id: uuidv4(), name, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    users.push(user);
    writeJson(USERS_FILE, users);
    res.status(201).json({ token: createToken(user), user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = readJson(USERS_FILE).find(candidate => candidate.email === email);
    if (!user || !passwordMatches(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password.' });
    res.json({ token: createToken(user), user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ id: req.user.id, name: req.user.name, email: req.user.email });
});

// Get all products
app.get('/api/products', (req, res) => {
    const products = readJson(PRODUCTS_FILE);
    res.json(products);
});

// Get product by barcode
app.get('/api/products/:barcode', async (req, res) => {
    const barcode = String(req.params.barcode || '').trim();
    if (!/^\d{8,14}$/.test(barcode)) return res.status(400).json({ error: 'Enter a valid 8–14 digit barcode.' });
    try {
        const product = await findProductByBarcode(barcode);
        if (!product) return res.status(404).json({ error: 'No product record was found for this barcode.' });
        res.json(product);
    } catch (error) {
        res.status(502).json({ error: error.message });
    }
});

// Analyze product
app.post('/api/analyze', async (req, res) => {
    const { barcode, ingredients, nutrition, healthProfile } = req.body;

    let product;

    if (barcode) {
        const normalizedBarcode = String(barcode).trim();
        if (!/^\d{8,14}$/.test(normalizedBarcode)) return res.status(400).json({ error: 'Enter a valid 8–14 digit barcode.' });
        try {
            product = await findProductByBarcode(normalizedBarcode);
        } catch (error) {
            return res.status(502).json({ error: error.message });
        }
        if (!product) return res.status(404).json({ error: 'No product record was found for this barcode. Try the ingredients option instead.' });
        product = applyVerifiedLabel(product, req.body.verifiedLabel);
    }

    // If no barcode match or manual entry, create temporary product
    if (!product) {
        product = {
            barcode: barcode || 'MANUAL-' + uuidv4(),
            name: req.body.productName || 'Unknown Product',
            brand: 'Unknown',
            ingredients: ingredients ? ingredients.split(',').map(i => ({
                name: i.trim(),
                type: 'unknown'
            })) : [],
            nutritionPer100g: nutrition || {},
            processingLevel: 'unknown',
            additivesCount: 0
        };
    }

    const analysis = analyzeProduct(product, healthProfile);
    res.json({ product, analysis });
});

// Save health profile
app.post('/api/health-profile', requireAuth, (req, res) => {
    const profiles = readJson(PROFILES_FILE);
    const profile = {
        id: uuidv4(),
        ...req.body,
        userId: req.user.id,
        createdAt: new Date().toISOString()
    };

    // Replace existing or add new
    const existingIndex = profiles.findIndex(p => p.userId === req.user.id);
    if (existingIndex >= 0) {
        profiles[existingIndex] = { ...profiles[existingIndex], ...req.body, updatedAt: new Date().toISOString() };
    } else {
        profiles.push(profile);
    }

    writeJson(PROFILES_FILE, profiles);
    res.json({ success: true, profile: existingIndex >= 0 ? profiles[existingIndex] : profile });
});

// Get health profile
app.get('/api/health-profile', requireAuth, (req, res) => {
    const profiles = readJson(PROFILES_FILE);
    const profile = profiles.find(p => p.userId === req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
});

// Add new product (for demo/testing)
app.post('/api/products', (req, res) => {
    const products = readJson(PRODUCTS_FILE);
    const newProduct = {
        barcode: req.body.barcode,
        ...req.body
    };
    products.push(newProduct);
    writeJson(PRODUCTS_FILE, products);
    res.json({ success: true, product: newProduct });
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 NutriScan AI Server running on http://localhost:${PORT}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`🌐 Frontend served from: ${path.join(__dirname, '../frontend')}`);
});
