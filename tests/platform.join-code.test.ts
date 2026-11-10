import test from "node:test";
import assert from "node:assert/strict";
import {JOIN_ALPHABET,newJoinCode,normalizeJoinCode,formatJoinCode,encryptJoinCode,decryptJoinCode,joinCodeHash} from "../src/platform/join-code-crypto.js";
test("PG codes have 60 random bits and reject ambiguous or malformed input",()=>{
 assert.equal(JOIN_ALPHABET.length,32);const codes=new Set(Array.from({length:1000},newJoinCode));assert.equal(codes.size,1000);
 for(const code of codes){assert.equal(code.length,12);assert.equal(normalizeJoinCode(formatJoinCode(code).toLowerCase()),code);}
 for(const invalid of ["","ABCDEFGHJKL","ABCD-EFGH-JKLM-N","OBCD-EFGH-JKLM","1BCD-EFGH-JKLM","../../../../../"] )assert.equal(normalizeJoinCode(invalid),null);
});
test("owner-retrievable code encryption is authenticated and separated from the join digest",()=>{
 const code=newJoinCode(),secret="isolated-secret-for-join-code-crypto";
 const a=encryptJoinCode(code,secret),b=encryptJoinCode(code,secret);
 assert.notEqual(a,b);assert.equal(decryptJoinCode(a,secret),code);assert.equal(joinCodeHash(code).length,64);assert.ok(!a.includes(code));
 assert.throws(()=>decryptJoinCode(a,"different key"));const chunks=a.split(".");chunks[2]=Buffer.alloc(16).toString("base64url");assert.throws(()=>decryptJoinCode(chunks.join("."),secret));
});
