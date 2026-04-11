"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useStore((s) => s.darkMode);
  const navLeft = useStore((s) => s.navLeft);

  useEffect(() => {
    const classes = [darkMode ? "dark" : "light"];
    if (navLeft) classes.push("nav-left");
    document.documentElement.className = classes.join(" ");
  }, [darkMode, navLeft]);

  return <>{children}</>;
}
