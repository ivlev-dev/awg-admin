import { readFilterQuery, syncFilterQuery } from "@/app/filter-url";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("filter-url", () => {
  it("reads the query only on matching paths", () => {
    window.history.replaceState(null, "", "/users?query=ann&tab=pending");
    expect(readFilterQuery("/users")?.get("query")).toBe("ann");
    expect(readFilterQuery("/clients")).toBeNull();
  });

  it("writes only non-empty filters and keeps unrelated paths", () => {
    window.history.replaceState(null, "", "/users?tab=pending#top");
    syncFilterQuery("/users", [
      ["tab", null],
      ["query", "ann"],
      ["role", null],
    ]);
    expect(window.location.pathname).toBe("/users");
    expect(window.location.search).toBe("?query=ann");
    expect(window.location.hash).toBe("#top");
  });

  it("clears the query when every filter is empty", () => {
    window.history.replaceState(null, "", "/clients?status=active");
    syncFilterQuery("/clients", [["status", null]]);
    expect(window.location.search).toBe("");
  });

  it("does not touch other sections", () => {
    window.history.replaceState(null, "", "/stats?range=week");
    syncFilterQuery("/users", [["query", "ann"]]);
    expect(window.location.search).toBe("?range=week");
  });

  it("matches only whole path segments", () => {
    window.history.replaceState(null, "", "/users-archive?query=ann");
    expect(readFilterQuery("/users")).toBeNull();

    syncFilterQuery("/users", [["query", "bob"]]);
    expect(window.location.search).toBe("?query=ann");
  });

  it("merges history state instead of dropping it", () => {
    window.history.replaceState({ modal: "open" }, "", "/users");
    syncFilterQuery("/users", [["query", "ann"]]);

    expect(window.history.state).toEqual({ modal: "open" });
  });
});
