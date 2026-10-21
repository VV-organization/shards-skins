import test from 'node:test';
import assert from 'node:assert/strict';
import {schemaType} from '../scripts/sync-api.mjs';

test('API types preserve integer category counts in additionalProperties maps',()=>{
 assert.equal(schemaType({type:'object',additionalProperties:{type:'integer',minimum:0}}),'Record<string, number>');
 assert.equal(schemaType({type:'object',required:['all','byCategory'],properties:{all:{type:'integer'},byCategory:{type:'object',additionalProperties:{type:'integer'}}}}),'{"all": number;\n"byCategory": Record<string, number>;}');
 assert.equal(schemaType({type:'object',additionalProperties:true}),'Record<string, unknown>');
});
