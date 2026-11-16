import { matchRoute, normalize, Router } from "./router";

describe("matchRoute", () => {
  it("root", () => {
    const match = matchRoute("/");
    expect(match.route.name).toBe("overview");
    expect(match.params).toEqual({});
  });

  it("client params", () => {
    const match = matchRoute("/clients/42");
    expect(match.route.name).toBe("client");
    expect(match.params).toEqual({ id: "42" });
  });

  it("group abc", () => {
    const match = matchRoute("/groups/abc");
    expect(match.route.name).toBe("group");
    expect(match.params).toEqual({ id: "abc" });
  });

  it("audit is admin only", () => {
    const match = matchRoute("/audit");
    expect(match.route.name).toBe("audit");
    expect(match.route.title).toBe("Аудит");
    expect(match.route.adminOnly).toBe(true);
  });

  it("unknown path falls back to overview", () => {
    const match = matchRoute("/does-not-exist");
    expect(match.route.name).toBe("overview");
    expect(match.params).toEqual({});
  });
});

describe("normalize", () => {
  it("empty", () => {
    expect(normalize("")).toBe("/");
  });

  it("root", () => {
    expect(normalize("/")).toBe("/");
  });

  it("trailing slash", () => {
    expect(normalize("/foo/")).toBe("/foo");
  });

  it("keeps path", () => {
    expect(normalize("/foo/bar")).toBe("/foo/bar");
  });
});

describe("Router", () => {
  it("navigate uses pushState and updates path", () => {
    const router = new Router();
    router.navigate("/clients/7");
    expect(router.path).toBe("/clients/7");
    expect(window.location.pathname).toBe("/clients/7");
  });

  it("navigate with replace", () => {
    const router = new Router();
    router.navigate("/groups/x", { replace: true });
    expect(router.path).toBe("/groups/x");
    expect(window.location.pathname).toBe("/groups/x");
  });

  it("same path is no-op", () => {
    const router = new Router();
    router.navigate("/");
    const before = window.location.pathname;
    router.navigate("/");
    expect(window.location.pathname).toBe(before);
  });

  it("popstate updates path", () => {
    const router = new Router();
    window.history.pushState(null, "", "/tariffs");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.path).toBe("/tariffs");
  });
});