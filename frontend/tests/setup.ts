import { registerDictionary } from "@/i18n";
import { en } from "@/i18n/en";
import { resetUnsavedRegistry } from "@/app/unsaved-state";

registerDictionary("en", en);

afterEach(() => {
  resetUnsavedRegistry();
});
