// Social tools (owner: Abdallah). Copy listSignups to add one; see personas/academic/tools.ts.
import type { Tool } from "../../core/types.ts";
import { loadMock } from "../../core/kit.ts";

export interface Activity {
  id: string;
  name: string;
  when: string;
  costEstimate?: number;
  signups: string[]; // phones
}
interface MockSocial {
  students: { phone: string; name: string }[];
  activities: Activity[];
}

const listSignups: Tool = {
  name: "list_signups",
  description:
    "List activities students have signed up for (who's in, when, rough cost). " +
    "Use for 'anyone down for…', plans, outings, trips, sports, or confirming someone is in.",
  parameters: {
    properties: {
      activity: { type: "string", description: "Optional word to filter by, e.g. 'beach' or 'soccer'." },
    },
  },
  async run(args, ctx) {
    // TODO(social): real sign-ups live in ctx.kv / a shared list; mock/students.json for now.
    const { students, activities } = loadMock<MockSocial>("students");
    const nameOf = (phone: string) => (phone === ctx.user.phone ? "you" : students.find((s) => s.phone === phone)?.name ?? phone);
    const q = typeof args.activity === "string" ? args.activity.toLowerCase() : "";
    const hits = activities.filter((a) => !q || `${a.id} ${a.name}`.toLowerCase().includes(q));
    if (hits.length === 0) return `No activities match "${q}".`;
    return hits
      .map((a) => `${a.name}, ${a.when}: ${a.signups.length} in (${a.signups.map(nameOf).join(", ")})${a.costEstimate ? `, ~$${a.costEstimate}` : ""}`)
      .join("\n");
  },
};

// TODO(social): join_activity (add ctx.user to signups), match people with the same interest, start the group chat.
export const tools: Tool[] = [listSignups];
