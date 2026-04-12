"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useStore((s) => s.darkMode);
  const navLeft = useStore((s) => s.navLeft);
  const navBottom = useStore((s) => s.navBottom);

  useEffect(() => {
    const classes = [darkMode ? "dark" : "light"];
    if (navBottom) classes.push("nav-bottom");
    else if (navLeft) classes.push("nav-left");
    document.documentElement.className = classes.join(" ");
  }, [darkMode, navLeft, navBottom]);

  return <>{children}</>;
}
