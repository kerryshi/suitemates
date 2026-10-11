// Governance gate (core/governance.ts). Fixtures are tonight's real texts (Messages DB, 2026-10-11).
import { test } from "node:test";

test.todo("G1: \"dean's texting you now\" with no dispatch is rewritten (01:59 Penny)");
test.todo("G1: curly apostrophe \"dean’s texting you now\" is caught too");
test.todo("G1: offering an agent already sent is rewritten as a statement (02:07 Sunny)");
test.todo("G2: a $ amount not in any tool result is dropped; \"$496\" from \"$496.00\" passes");
test.todo("G3: Penny stating a due date without a Dean tool result is redirected");
test.todo("G4: empty / \"(no reply)\" / duplicate dropped; a recruit text is replaced, not silenced");
test.todo("good texts from tonight pass byte-for-byte");
test.todo("GOVERN=0 passes everything through");
