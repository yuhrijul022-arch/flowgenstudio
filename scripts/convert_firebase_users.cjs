#!/usr/bin/env node
// ============================================================
// Firebase User Data → CSV Converter for Supabase Migration
// ============================================================
// Usage:
//   node scripts/convert_firebase_users.js
//
// Input:  Firebase user text files in project root (*.txt)
//         OR a firebase_users.json array
// Output: scripts/firebase_users_migration.csv  (for Supabase import)
//         scripts/firebase_users_migration.json (for reference)
// ============================================================

const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = __dirname;
const CSV_FILE = path.join(OUTPUT_DIR, 'firebase_users_migration.csv');
const JSON_FILE = path.join(OUTPUT_DIR, 'firebase_users_migration.json');

// ── Firebase text file parser ──────────────────────────────
// Parses the Firestore Console copy-paste format:
//   fieldName
//   value
//   (type)
function parseFirebaseTextFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const data = {};
    let i = 0;

    while (i < lines.length) {
        const fieldName = lines[i];

        // Skip if this line looks like a type indicator
        if (fieldName.startsWith('(') && fieldName.endsWith(')')) {
            i++;
            continue;
        }

        // Next line is the value
        const valueLine = lines[i + 1];
        // Line after that may be the type
        const typeLine = lines[i + 2];

        if (valueLine !== undefined) {
            let value = valueLine;

            // Remove surrounding quotes from string values
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }

            // Determine if this is a known field
            const knownFields = [
                'createdAt', 'credits', 'displayName', 'email',
                'lastLoginAt', 'photoURL', 'reservedCredits',
                'role', 'source', 'uid', 'updatedAt'
            ];

            if (knownFields.includes(fieldName)) {
                data[fieldName] = value;
            }
        }

        // Skip value + type lines
        if (typeLine && typeLine.startsWith('(') && typeLine.endsWith(')')) {
            i += 3;
        } else {
            i += 2;
        }
    }

    return data;
}

// ── Timestamp converter ────────────────────────────────────
// Converts "March 3, 2026 at 9:05:49 AM UTC+7" → ISO-8601 UTC
function parseFirebaseTimestamp(str) {
    if (!str) return null;

    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return new Date(str).toISOString();
    }

    // Parse "Month Day, Year at H:MM:SS AM/PM UTC+N"
    const match = str.match(
        /^(\w+)\s+(\d+),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)\s*UTC([+-]\d+)?$/i
    );

    if (!match) {
        console.warn(`⚠️  Could not parse timestamp: "${str}"`);
        return null;
    }

    const [, monthName, day, year, hours, minutes, seconds, ampm, utcOffset] = match;

    const months = {
        January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
        July: 6, August: 7, September: 8, October: 9, November: 10, December: 11
    };

    let h = parseInt(hours, 10);
    if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
    if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;

    // Create date in the given UTC offset, then convert to UTC
    const offsetHours = utcOffset ? parseInt(utcOffset, 10) : 0;

    const date = new Date(Date.UTC(
        parseInt(year, 10),
        months[monthName],
        parseInt(day, 10),
        h - offsetHours,  // adjust to UTC
        parseInt(minutes, 10),
        parseInt(seconds, 10)
    ));

    return date.toISOString();
}

// ── Transform to migration format ─────────────────────────
function transformUser(raw) {
    return {
        firebase_uid: raw.uid || '',
        email: raw.email || '',
        display_name: raw.displayName || '',
        photo_url: raw.photoURL || '',
        credits: parseInt(raw.credits, 10) || 0,
        reserved_credits: parseInt(raw.reservedCredits, 10) || 0,
        role: raw.role || 'user',
        source: raw.source || 'organic',
        joined_at: parseFirebaseTimestamp(raw.createdAt) || '',
    };
}

// ── CSV generation ─────────────────────────────────────────
function escapeCSV(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function toCSV(users) {
    const headers = [
        'firebase_uid', 'email', 'display_name', 'photo_url',
        'credits', 'reserved_credits', 'role', 'source', 'joined_at'
    ];

    const headerLine = headers.join(',');
    const rows = users.map(u =>
        headers.map(h => escapeCSV(u[h])).join(',')
    );

    return [headerLine, ...rows].join('\n');
}

// ── Main ───────────────────────────────────────────────────
function main() {
    console.log('🔄 Firebase → Supabase User Data Converter');
    console.log('='.repeat(50));

    const users = [];

    // Strategy 1: Look for a JSON file with all users
    const jsonInput = path.join(PROJECT_ROOT, 'firebase_users.json');
    if (fs.existsSync(jsonInput)) {
        console.log(`📄 Found ${jsonInput}`);
        const rawUsers = JSON.parse(fs.readFileSync(jsonInput, 'utf-8'));
        const arr = Array.isArray(rawUsers) ? rawUsers : [rawUsers];
        arr.forEach(raw => users.push(transformUser(raw)));
        console.log(`   → Parsed ${arr.length} users from JSON`);
    }

    // Strategy 2: Look for Firebase text files in project root
    const textFiles = fs.readdirSync(PROJECT_ROOT)
        .filter(f => f.endsWith('.txt') && f.toLowerCase().includes('user') && f.toLowerCase().includes('flowgen'));

    if (textFiles.length > 0) {
        console.log(`📄 Found ${textFiles.length} Firebase text file(s):`);
        textFiles.forEach(file => {
            const filePath = path.join(PROJECT_ROOT, file);
            console.log(`   → Parsing: ${file}`);
            const raw = parseFirebaseTextFile(filePath);
            const user = transformUser(raw);

            // Check if user already added (from JSON)
            const existing = users.findIndex(u => u.email === user.email);
            if (existing >= 0) {
                console.log(`   ⚠️  Duplicate email ${user.email} — using text file version`);
                users[existing] = user;
            } else {
                users.push(user);
            }
        });
    }

    if (users.length === 0) {
        console.error('❌ No Firebase user data found!');
        console.error('   Place firebase_users.json or *user*flowgen*.txt files in the project root.');
        process.exit(1);
    }

    // Print summary
    console.log('\n📊 Migration Summary:');
    console.log('-'.repeat(50));
    users.forEach((u, i) => {
        console.log(`  ${i + 1}. ${u.display_name} (${u.email})`);
        console.log(`     Firebase UID: ${u.firebase_uid}`);
        console.log(`     Credits: ${u.credits} | Reserved: ${u.reserved_credits}`);
        console.log(`     Joined: ${u.joined_at}`);
    });

    // Write CSV
    const csvContent = toCSV(users);
    fs.writeFileSync(CSV_FILE, csvContent, 'utf-8');
    console.log(`\n✅ CSV saved: ${CSV_FILE}`);

    // Write JSON
    fs.writeFileSync(JSON_FILE, JSON.stringify(users, null, 2), 'utf-8');
    console.log(`✅ JSON saved: ${JSON_FILE}`);

    // Print SQL INSERT preview
    console.log('\n📋 SQL INSERT preview (for manual use):');
    console.log('-'.repeat(50));
    users.forEach(u => {
        console.log(`INSERT INTO public.firebase_migrated_users`);
        console.log(`  (firebase_uid, email, display_name, photo_url, credits, reserved_credits, role, source, joined_at)`);
        console.log(`VALUES`);
        console.log(`  ('${u.firebase_uid}', '${u.email}', '${u.display_name}', '${u.photo_url}', ${u.credits}, ${u.reserved_credits}, '${u.role}', '${u.source}', '${u.joined_at}')`);
        console.log(`ON CONFLICT (email) DO UPDATE SET credits = EXCLUDED.credits;`);
        console.log();
    });

    console.log('🎉 Done! Upload the CSV to Supabase:');
    console.log('   Dashboard → Table Editor → firebase_migrated_users → Import CSV');
}

main();
