import { escapeLike } from "@/lib/like-escape";
import { printStyles } from "@/lib/print-template";

test("LIKE wildcards in a typed email are matched literally", () => {
  expect(escapeLike("%")).toBe("\\%");
  expect(escapeLike("a_b@x.com")).toBe("a\\_b@x.com");
  expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  expect(escapeLike("plain@x.com")).toBe("plain@x.com");
});

test("a brand colour that isn't a hex colour never reaches the print stylesheet", () => {
  const css = printStyles({ accent: "</style><script>alert(1)</script>", accent2: "red;}body{display:none" });
  expect(css).not.toContain("<script>");
  expect(css).not.toContain("display:none");
  expect(printStyles({ accent: "#cd2425" })).toContain("#cd2425");
});
