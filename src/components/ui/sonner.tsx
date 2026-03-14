"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useAppTheme } from "@/theme/use-app-theme"

function Toaster({ ...props }: ToasterProps) {
  const { theme } = useAppTheme()

  return (
    <Sonner
      offset="16px"
      theme={theme}
      className="toaster group z-[80]"
      toastOptions={{
        classNames: {
          toast:
            "group toast z-[80] group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:border-border group-[.toast]:bg-background group-[.toast]:text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
