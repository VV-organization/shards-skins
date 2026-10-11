import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const baseline=JSON.parse(readFileSync('../docs/testing/designer-source-baseline.json','utf8'));
const preserved=Object.keys(baseline).filter(path=>path.startsWith('public/')||['src/app/selection.css','src/components/motion.tsx','src/components/hero-skin-carousel.tsx','src/components/skin-inspection.tsx','src/components/icon.tsx'].includes(path));
for(const path of preserved){if(createHash('sha256').update(readFileSync(path)).digest('hex')!==baseline[path])throw new Error(`Designer asset/animation changed: ${path}`);}
console.log(`Verified ${preserved.length} original assets, fonts and animation sources.`);
const css=readFileSync('../docs/testing/visual-baseline/globals.css','utf8');
if(createHash('sha256').update(css).digest('hex')!==baseline['src/app/globals.css'])throw new Error('Original CSS evidence changed');
const withoutFloat=css.replace(/[^{}]*\.float-(?:block|track|labels)[^{}]*\{[^{}]*\}/g,'').replace(/\s/g,'');
if(readFileSync('src/app/globals.css','utf8').replace(/\s/g,'')!==withoutFloat)throw new Error('CSS changed beyond approved float removal');
console.log('Original stylesheet preserved except approved float rules.');
