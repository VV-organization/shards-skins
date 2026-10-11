import { expect, it } from 'vitest';
import { normalizeSkin } from './catalog-normalization';
it('recognizes knife and gloves without confusing the star or StatTrak prefixes',()=>{
  expect(normalizeSkin('★ StatTrak™ Karambit | Doppler (Factory New)')).toMatchObject({categoryId:'knife',weapon:'Karambit',condition:'FN',stattrak:true});
  expect(normalizeSkin('★ Hand Wraps | Overprint (Field-Tested)')).toMatchObject({categoryId:'gloves',weapon:'Hand Wraps',condition:'FT'});
  expect(normalizeSkin('★ Hydra Gloves | Rattler (Well-Worn)')).toMatchObject({categoryId:'gloves',condition:'WW'});
  expect(normalizeSkin('Mystery | Finish',{categoryName:'Перчатки'}).categoryId).toBe('gloves');
  expect(normalizeSkin('Mystery | Finish').categoryId).toBeNull();
});
it('keeps wear and StatTrak variants distinguishable',()=>{
  expect(normalizeSkin('StatTrak™ AK-47 | Redline (Minimal Wear)')).toMatchObject({categoryId:'rifle',condition:'MW',stattrak:true});
  expect(normalizeSkin('AK-47 | Redline (Field-Tested)')).toMatchObject({condition:'FT',stattrak:false});
});
