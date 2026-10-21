UPDATE pricing_settings
SET metadata = metadata - 'fxVerified'
WHERE metadata ? 'fxVerified';
