import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector } from "../src/index.js";

test("empty vector has size 0 and returns undefined", () => {
  const v = Vector.empty();
  assert.equal(v.size, 0);
  assert.equal(v.get(0), undefined);
  assert.equal(v.get(-1), undefined);
});

test("push builds a sequence and leaves the original unchanged", () => {
  const v0 = Vector.empty();
  const v1 = v0.push("a");
  const v2 = v1.push("b");
  const v3 = v2.push("c");
  assert.equal(v0.size, 0);
  assert.equal(v1.size, 1);
  assert.equal(v2.size, 2);
  assert.equal(v3.size, 3);
  assert.equal(v1.get(0), "a");
  assert.equal(v2.get(0), "a");
  assert.equal(v2.get(1), "b");
  assert.equal(v3.get(2), "c");
});

test("push over a full leaf grows the tree", () => {
  let v = Vector.empty();
  for (let i = 0; i < 32; i++) v = v.push(i);
  // 32 elements: height 0, full leaf.
  assert.equal(v.size, 32);
  assert.equal(v.height, 0);
  for (let i = 0; i < 32; i++) assert.equal(v.get(i), i);

  // Pushing one more forces height 1.
  const w = v.push(32);
  assert.equal(w.size, 33);
  assert.equal(w.height, 1);
  for (let i = 0; i <= 32; i++) assert.equal(w.get(i), i);

  // The old vector is untouched.
  assert.equal(v.size, 32);
  assert.equal(v.height, 0);
  assert.equal(v.get(32), undefined);
});

test("push over a full subtree grows again at 1024", () => {
  let v = Vector.empty();
  for (let i = 0; i < 1024; i++) v = v.push(i);
  assert.equal(v.size, 1024);
  assert.equal(v.height, 1);

  const w = v.push(1024);
  assert.equal(w.size, 1025);
  assert.equal(w.height, 2);
  assert.equal(w.get(1024), 1024);
  assert.equal(w.get(0), 0);
  assert.equal(v.get(1024), undefined);
});

test("set updates an existing index without mutating the source", () => {
  const v = Vector.from(["a", "b", "c", "d"]);
  const w = v.set(2, "X");
  assert.equal(v.get(2), "c");
  assert.equal(w.get(2), "X");
  assert.deepEqual(w.toArray(), ["a", "b", "X", "d"]);
});

test("set on a large vector preserves structural sharing semantics", () => {
  let v = Vector.empty();
  for (let i = 0; i < 1000; i++) v = v.push(i);
  const w = v.set(500, -1);
  assert.equal(v.get(500), 500);
  assert.equal(w.get(500), -1);
  assert.equal(w.get(0), 0);
  assert.equal(w.get(999), 999);
  assert.equal(w.size, 1000);
});

test("set throws on out-of-range indices", () => {
  const v = Vector.from([1, 2, 3]);
  assert.throws(() => v.set(-1, 0), RangeError);
  assert.throws(() => v.set(3, 0), RangeError);
  assert.throws(() => v.set(2.5, 0), RangeError);
  assert.throws(() => v.set("x", 0), RangeError);
});

test("pop removes the last element", () => {
  const v = Vector.from([1, 2, 3, 4]);
  const w = v.pop();
  assert.equal(v.size, 4);
  assert.equal(w.size, 3);
  assert.deepEqual(w.toArray(), [1, 2, 3]);
  assert.equal(v.get(3), 4);
  assert.equal(w.get(3), undefined);
});

test("pop on empty returns the same empty vector", () => {
  const e = Vector.empty();
  const r = e.pop();
  assert.equal(r, e);
  assert.equal(r.size, 0);
});

test("pop across height boundary shrinks the tree", () => {
  let v = Vector.empty();
  for (let i = 0; i < 33; i++) v = v.push(i);
  assert.equal(v.height, 1);
  const w = v.pop();
  assert.equal(w.size, 32);
  assert.equal(w.height, 0);
  for (let i = 0; i < 32; i++) assert.equal(w.get(i), i);
  assert.equal(w.get(32), undefined);
});

test("pop across the 1024 boundary shrinks height from 2 to 1", () => {
  let v = Vector.empty();
  for (let i = 0; i < 1025; i++) v = v.push(i);
  assert.equal(v.height, 2);
  const w = v.pop();
  assert.equal(w.size, 1024);
  assert.equal(w.height, 1);
  for (let i = 0; i < 1024; i++) assert.equal(w.get(i), i);
});

test("from builds a vector and round-trips through toArray", () => {
  const src = [];
  for (let i = 0; i < 1000; i++) src.push(i * 2);
  const v = Vector.from(src);
  assert.equal(v.size, 1000);
  assert.deepEqual(v.toArray(), src);
});

test("from accepts null and returns an empty vector", () => {
  assert.equal(Vector.from(null).size, 0);
  assert.equal(Vector.from(undefined).size, 0);
});

test("from accepts a Set", () => {
  const s = new Set([10, 20, 30]);
  const v = Vector.from(s);
  assert.equal(v.size, 3);
  assert.deepEqual(v.toArray().sort((a, b) => a - b), [10, 20, 30]);
});

test("from on a Vector returns the same instance", () => {
  const v = Vector.from([1, 2, 3]);
  assert.equal(Vector.from(v), v);
});

test("slice returns a plain array copy", () => {
  const v = Vector.from([0, 1, 2, 3, 4, 5]);
  const s = v.slice(1, 4);
  assert.ok(Array.isArray(s));
  assert.deepEqual(s, [1, 2, 3]);
  // original unchanged
  assert.equal(v.size, 6);
});

test("get returns undefined for out-of-range indices", () => {
  const v = Vector.from(["a", "b"]);
  assert.equal(v.get(-1), undefined);
  assert.equal(v.get(2), undefined);
  assert.equal(v.get(100), undefined);
  assert.equal(v.get("x"), undefined);
});

test("toArray on empty returns an empty array", () => {
  assert.deepEqual(Vector.empty().toArray(), []);
});

test("large push/set/pop sequence is consistent", () => {
  let v = Vector.empty();
  for (let i = 0; i < 5000; i++) v = v.push(i);
  assert.equal(v.size, 5000);
  for (let i = 0; i < 5000; i += 500) assert.equal(v.get(i), i);
  v = v.set(2500, -2500);
  assert.equal(v.get(2500), -2500);
  for (let i = 0; i < 1000; i++) v = v.pop();
  assert.equal(v.size, 4000);
  assert.equal(v.get(3999), 3999);
  assert.equal(v.get(4000), undefined);
});

test("structural sharing keeps old versions stable after many pushes", () => {
  let v = Vector.empty();
  for (let i = 0; i < 100; i++) v = v.push(i);
  const snapshot = v;
  let v2 = v;
  for (let i = 100; i < 200; i++) v2 = v2.push(i);
  // snapshot is unchanged.
  assert.equal(snapshot.size, 100);
  for (let i = 0; i < 100; i++) assert.equal(snapshot.get(i), i);
  assert.equal(snapshot.get(100), undefined);
  // v2 has the new values.
  assert.equal(v2.size, 200);
  for (let i = 0; i < 200; i++) assert.equal(v2.get(i), i);
});

test("set then pop on boundary indices behaves consistently", () => {
  let v = Vector.empty();
  for (let i = 0; i < 32; i++) v = v.push(i);
  // Set the last element of the leaf, then pop it off.
  const w = v.set(31, 999);
  assert.equal(w.get(31), 999);
  const x = w.pop();
  assert.equal(x.size, 31);
  assert.equal(x.get(31), undefined);
  for (let i = 0; i < 31; i++) assert.equal(x.get(i), i);
});

test("toStringTag is Vector", () => {
  assert.equal(Object.prototype.toString.call(Vector.empty()), "[object Vector]");
});
