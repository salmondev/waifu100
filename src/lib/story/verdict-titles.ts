import type { StoryItem } from "@/lib/share-schema";

/** "Title (anime|manga|light novel|...)" - any MediaType, lower-cased per filled cell, in rank order - what the story verdict prompt reads. */
export const storyVerdictTitles = (items: (StoryItem | null)[]) =>
    items.filter((x): x is StoryItem => !!x).map((x) => `${String(x.title).slice(0, 120)} (${x.type === "NOVEL" ? "light novel" : String(x.type || "ANIME").toLowerCase()})`);
