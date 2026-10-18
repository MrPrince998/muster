"use client";

import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import Image from "next/image";

/** The product mark: a condensed wordmark, in the same voice as the headlines. */
export function Logo({
  className,
}: {
  className?: string;
  inverted?: boolean;
}) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <Image
      src="/muster_logo_inverted.png"
      alt="Muster"
      width={100}
      height={25}
      className={cn(className)}
    />
  ) : (
    <Image
      src="/muster_logo.png"
      alt="Muster"
      width={100}
      height={25}
      className={cn(className)}
    />
  );
}
