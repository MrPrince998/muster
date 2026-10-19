import { ImageDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Saves the ticket as a picture (to the camera roll, or Downloads): it gets
 * you in with no signal and without opening Muster. Drawn by the web server
 * from the ticket's own token, so it works for members and guests alike.
 */
export function SaveTicketImage({ token, className }: { token: string; className?: string }) {
  return (
    <a
      href={`/t/${encodeURIComponent(token)}/image`}
      // named by the server: "<event>-ticket.png"
      download
      className={cn(buttonVariants({ variant: "outline" }), className)}
    >
      <ImageDown aria-hidden />
      Save ticket image
    </a>
  );
}
