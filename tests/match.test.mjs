import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// src/utils/match.ts is dependency-free (its only import is a type); transpile and import it directly.
const source = await readFile(new URL("../src/utils/match.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { cleanTrackTitle, rankMatches, scoreTrackMatch, matchScore, tokenize } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const song = (id, title, artist) => ({ id: `/songs/${id}.html`, title, artist, pageUrl: `https://pagalnew.com/songs/${id}.html`, imageUrl: null });

test("cleanTrackTitle drops Spotify decorations but never empties a title", () => {
  assert.equal(cleanTrackTitle('Tainu Khabar Nahi - From "Munjya"'), "Tainu Khabar Nahi");
  assert.equal(cleanTrackTitle("Inaam (Ft. Badshah)"), "Inaam");
  assert.equal(cleanTrackTitle("Song [Live] - Remastered 2011"), "Song");
  assert.equal(cleanTrackTitle("love."), "love.");
  assert.equal(cleanTrackTitle("(Intro)"), "(Intro)");
});

test("an exact title by the same artist is a confident match", () => {
  const { status, candidates } = rankMatches(
    { title: 'Tainu Khabar Nahi - From "Munjya"', artist: "Sachin-Jigar, Arijit Singh" },
    [song("a", "Tainu Khabar Nahi", "Arijit Singh"), song("b", "Khabar Nahi", "Someone Else")],
  );
  assert.equal(status, "matched");
  assert.equal(candidates[0].song.id, "/songs/a.html");
});

test("same title, different artist is only a possible match (not preselected)", () => {
  const { status } = rankMatches({ title: "All of Me", artist: "John Legend" }, [song("c", "All of Me", "Arijit Singh")]);
  assert.equal(status, "possible");
});

test("a title that only contains the Spotify title is never preselected", () => {
  // Live regression: "blue" by yung kai used to match "Blue Hai Paani Paani".
  assert.notEqual(rankMatches({ title: "blue", artist: "yung kai" }, [song("g", "Blue Hai Paani Paani", "Yo Yo Honey Singh")]).status, "matched");
  // Same title by a different artist is offered but not selected.
  assert.equal(rankMatches({ title: "Those Eyes", artist: "New West" }, [song("h", "Those Eyes", "Amrit Maan, Himtown Baddie")]).status, "possible");
  // The page slug no longer counts: "love." must not match an unrelated title.
  assert.equal(rankMatches({ title: "love.", artist: "wave to earth" }, [{ ...song("i", "Teri Pehli Nazar", "Raghav Chaitanya"), pageUrl: "https://pagalnew.com/songs/love-songs/teri-pehli-nazar.html" }]).status, "unmatched");
});

test("any credited artist can confirm a match; local title decorations are ignored", () => {
  const s = scoreTrackMatch(song("j", "Kasturi (From Amar Prem Ki Prem Kahani)", "Arijit Singh"), { title: 'Kasturi (From "Amar Prem Ki Prem Kahani")', artist: "Pritam, Arijit Singh" });
  assert.equal(s.title, 1);
  assert.equal(s.artist, 1);
});

test("unrelated results are unmatched; no results is unmatched with no candidates", () => {
  assert.equal(rankMatches({ title: "Coming Up Roses", artist: "Harry Styles" }, [song("d", "Kesariya", "Arijit Singh")]).status, "unmatched");
  assert.deepEqual(rankMatches({ title: "Sofia", artist: "Clairo" }, []), { status: "unmatched", candidates: [] });
});

test("duplicate search results collapse to one candidate", () => {
  const s = song("e", "Majboor", "Sheheryar Rehan");
  assert.equal(rankMatches({ title: "Majboor", artist: "Sheheryar Rehan, Zoha Waseem" }, [s, s, { ...s }]).candidates.length, 1);
});

test("search scoring is unchanged by the move out of services/api.ts", () => {
  assert.deepEqual(tokenize("Kesariya — Arijit!"), ["kesariya", "arijit"]);
  assert.equal(matchScore(song("f", "Kesariya", "Arijit Singh"), ["kesariya", "arijit"]), 1);
  assert.ok(matchScore(song("f", "Kesariya", "Arijit Singh"), ["kesarya"]) > 0.6);
});
