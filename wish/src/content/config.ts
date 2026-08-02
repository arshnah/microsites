import { defineCollection, z } from "astro:content";

// One section type per shape the plan calls for. Extra keys per-type keep the
// switch in [slug].astro simple — no generic "content: any" escape hatch.
const messageSection = z.object({
  type: z.literal("message"),
  heading: z.string(),
  body: z.string(),
});
const timelineSection = z.object({
  type: z.literal("timeline"),
  heading: z.string(),
  items: z.array(z.object({ date: z.string(), text: z.string() })),
});
const gallerySection = z.object({
  type: z.literal("gallery"),
  heading: z.string(),
  images: z.array(z.string()),
});
const wishesSection = z.object({
  type: z.literal("wishes"),
  heading: z.string(),
  items: z.array(z.object({ from: z.string(), text: z.string() })),
});
const statsSection = z.object({
  type: z.literal("stats"),
  heading: z.string(),
  items: z.array(z.object({ label: z.string(), value: z.string() })),
});

const celebrations = defineCollection({
  type: "data",
  schema: z.object({
    slug: z.string(),
    type: z.enum(["birthday", "anniversary", "friendship", "custom"]),
    title: z.string(),
    person: z.string(),
    date: z.string(), // YYYY-MM-DD
    tagline: z.string().optional(),
    hero_quote: z.string().optional(),
    // ISO datetime with offset. null/omitted = already happened, no countdown.
    countdown_to: z.string().nullable().optional(),
    sections: z.array(
      z.discriminatedUnion("type", [
        messageSection,
        timelineSection,
        gallerySection,
        wishesSection,
        statsSection,
      ])
    ),
    theme: z
      .object({
        accent: z.string().optional(),
        moon_phase: z.string().optional(),
      })
      .optional(),
    guestbook_enabled: z.boolean().default(false),
    private: z.boolean().default(false),
  }),
});

export const collections = { celebrations };
