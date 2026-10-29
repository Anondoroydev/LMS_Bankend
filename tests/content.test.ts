import { describe, expect, it } from "vitest";
import { contentSchema } from "../src/validators/schemas.js";

const baseContent = {
  title: "Lesson notes",
  folderId: "815b0715-3ddb-4f85-a3bf-3705790801dc",
};

describe("content validation", () => {
  it("accepts written lessons with text", () => {
    const result = contentSchema.safeParse({
      ...baseContent,
      type: "TEXT",
      textContent: "Read these notes before class.\nBring your questions.",
    });

    expect(result.success).toBe(true);
  });

  it("requires non-empty text for written lessons", () => {
    const result = contentSchema.safeParse({ ...baseContent, type: "TEXT", textContent: "  " });

    expect(result.success).toBe(false);
  });

  it("keeps live class lessons URL-based", () => {
    const result = contentSchema.safeParse({
      ...baseContent,
      type: "LIVE_LINK",
      liveUrl: "https://meet.example.com/class",
    });

    expect(result.success).toBe(true);
  });
});
