const { validateTelemetryPayload } = require('../../server/validation');

console.log('Testing validateTelemetryPayload with non-numeric inputs:');

const testCases = [
  { name: 'String numeric "26.4499"', payload: { lat: '26.4499', lng: '80.3319' } },
  { name: 'Single-element array [26.4499]', payload: { lat: [26.4499], lng: [80.3319] } },
  { name: 'Boolean true / false', payload: { lat: true, lng: false } },
  { name: 'Pure numbers 26.4499, 80.3319', payload: { lat: 26.4499, lng: 80.3319 } }
];

for (const tc of testCases) {
  const res = validateTelemetryPayload(tc.payload);
  console.log(`- ${tc.name}: valid = ${res.valid}, error = ${res.error || 'none'}`);
}
