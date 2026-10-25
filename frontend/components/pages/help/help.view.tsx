import Link from "next/link";

const link = "font-medium text-cobalt underline-offset-4 hover:underline";

interface Answer {
  q: string;
  a: React.ReactNode;
}

const SECTIONS: { title: string; answers: Answer[] }[] = [
  {
    title: "Getting in",
    answers: [
      {
        q: "How do I join a workspace?",
        a: (
          <>
            Open the invite link someone sent you, or press the link button in the left rail and paste it. Some
            workspaces let anyone with the link straight in; others ask an admin to approve you first.
          </>
        ),
      },
      {
        q: "Why can I only see some clubs?",
        a: "Joining a workspace puts you in its General club. Each club decides who else gets in: open Browse clubs to join the ones anyone can join, or ask to join the ones that approve people first. Clubs that take invite links only don't show there; ask someone in one for a link.",
      },
      {
        q: "How do I find something quickly?",
        a: "Press ⌘K (Ctrl+K on Windows) or the search box at the top. It finds clubs, events and people across all your workspaces.",
      },
    ],
  },
  {
    title: "Events and tickets",
    answers: [
      {
        q: "Where's my ticket?",
        a: (
          <>
            Register for an event and your ticket arrives by email, with the QR code attached. It&rsquo;s always in{" "}
            <Link href="/tickets" className={link}>
              My tickets
            </Link>{" "}
            too, in the account menu.
          </>
        ),
      },
      {
        q: "What if there's no signal at the door?",
        a: "Open your ticket and choose Save ticket image. The picture has the QR code on it and works like the ticket, so keep it in your photos and show it at the door. The QR code attached to your ticket email works offline too.",
      },
      {
        q: "How do paid tickets work?",
        a: "A workspace's owner or an admin sets up payments in Settings, one of two ways, and either way the money goes straight to the organisers: Muster never holds it. Through Stripe, ticket money goes to the workspace's own Stripe account; your ticket arrives as soon as the payment goes through, a ticket given back before the event's refund cut-off (48 hours by default) is refunded, and if the organisers cancel, everyone is refunded. Or, where Stripe isn't available (Nepal, say), the organisers are paid directly: eSewa, Khalti, a bank transfer or cash, in their own words and with their QR code. Your place is held while you pay with a short reference, and your ticket arrives once an organiser confirms the payment; refunds are up to them.",
      },
      {
        q: "Can an event have a picture?",
        a: "Yes. In the event's form, choose Add a cover image: a JPEG, PNG or WebP photo. It's made smaller in your browser before it uploads, and shows on the event and its public page.",
      },
      {
        q: "Can an event have different tickets, or discount codes?",
        a: "Yes. In the event's form, add tickets: each has a name and a price (empty for free), and can be for members only, limited in number, or on sale until a date (an early bird). With no tickets, the event is free. For paid tickets, Discount codes on the event makes codes for a percentage or an amount off, with a limit if you like. A code that makes a ticket free skips payment altogether.",
      },
      {
        q: "Can I give my place back?",
        a: "Yes, until you've been checked in: open the event and choose Cancel my place, so someone else can have it.",
      },
      {
        q: "The event is full. Can I still go?",
        a: "Join the waitlist on the event. When someone gives their place back, it goes to whoever has waited longest, and their ticket arrives by email straight away.",
      },
      {
        q: "Will I get a reminder?",
        a: "Yes: an email the day before, with your ticket attached. If you registered within that last day, your ticket email is your reminder.",
      },
      {
        q: "Can I get an email when a club adds an event?",
        a: "Yes. On the club's page, open Follow and choose an email for each new event, or a weekly digest every Monday of the next two weeks. It's off until you choose. Every one of these emails has a link to stop them, no sign-in needed.",
      },
      {
        q: "Can I see all of a club's events in my calendar?",
        a: "Yes. On the club's page, open Follow, choose Add to my calendar and add it to Apple Calendar, Outlook or Google Calendar. New events then appear by themselves, and changes and cancellations follow. The link is private to you; if it gets out, reset it from the same place.",
      },
      {
        q: "Can I add an event to my calendar?",
        a: "Yes. Your ticket email has the event attached: open it to add it to Apple Calendar, Outlook and most others. Or use Add to calendar on your ticket (or on a public event's page) for the file or Google Calendar. If the event changes, add it again and it replaces the old entry.",
      },
      {
        q: "What happens if an event is cancelled or moved?",
        a: "Everyone registered gets an email. A cancelled event's tickets stop working at the door; after a move, your ticket still works.",
      },
    ],
  },
  {
    title: "Running a club",
    answers: [
      {
        q: "Who can create and publish events?",
        a: "It depends on your role in the club. Admins and Organizers can create, publish and edit events; Scanners can check people in at the door.",
      },
      {
        q: "Where are a club's settings?",
        a: "On the club's page, choose Settings. General has its name, description and who can join: anyone in the workspace, people who ask, or invite links only. Members, Join requests, Invite links, Roles and Attendance are there too, each for the people whose role allows it. A number on Settings means people are waiting to join.",
      },
      {
        q: "Can an event repeat?",
        a: "Yes. In New event, choose Repeats (every week, fortnight or month) and how many times. Each one is its own event, with its own places and tickets. When you edit, cancel, publish or delete one, you can choose just that one or it and every later one.",
      },
      {
        q: "Can I find out what people thought of an event?",
        a: "Yes. A couple of hours after an event ends, everyone who was checked in gets one email asking how it was: a rating out of five and a comment if they like. Open the event under Past to see the average and the comments. Answers never show who gave them.",
      },
      {
        q: "Can I ask people questions when they register?",
        a: "Yes, up to five per event: a short answer, or one choice from a list (dietary needs, T-shirt sizes), required or optional. Add them in the event's form. They're asked however someone takes a place, guests included. The event shows a tally of the choices, and the spreadsheet has every answer.",
      },
      {
        q: "How do I tell everyone going about a change?",
        a: "Open the event and choose Message everyone going. It emails everyone with a place, guests included, and the waitlist if you tick it. What you've sent is listed there, so nobody says it twice. Up to ten messages a day per event.",
      },
      {
        q: "How do I stop registrations without cancelling?",
        a: "Open the event and choose Close registration. People already going keep their place, and you can open it again later.",
      },
      {
        q: "Can I get the attendee list as a spreadsheet?",
        a: "Yes: open the event and choose Download list, next to Who's going. It has everyone's name, whether they came in, and the waitlist, with times in your workspace's time zone.",
      },
      {
        q: "How does check-in work?",
        a: "On the day, open the event and choose Open check-in, then scan each ticket's QR code. A ticket works once; a copy is turned away.",
      },
      {
        q: "What if the door has no signal?",
        a: "Open check-in once while you have a connection: your phone keeps the door list. If the connection drops, keep scanning or checking people in by name; the phone checks tickets itself and sends them as soon as it's back online. If one of those tickets had already been used at another door, you'll be told.",
      },
    ],
  },
  {
    title: "Your account",
    answers: [
      {
        q: "Who can see that I'm in a workspace?",
        a: "Its moderators, admins and owner see everyone in it. Other members see you only if you share a club with them (General doesn't count, since everyone's in it), on the Members page and in search alike. Nobody but the staff sees your email.",
      },
      {
        q: "Can I see who changed what?",
        a: "Yes, if you're the workspace's owner or an admin: Activity, in the workspace menu, lists changes to roles, members, events, invites and settings, plus attendee-list downloads and check-ins by name, each with who and when. Nobody can edit or delete that list.",
      },
      {
        q: "How do I change my name or password?",
        a: (
          <>
            On your{" "}
            <Link href="/account" className={link}>
              Account
            </Link>{" "}
            page. You can also sign out devices you don&rsquo;t recognise there.
          </>
        ),
      },
      {
        q: "I forgot my password.",
        a: (
          <>
            Use{" "}
            <Link href="/forgot-password" className={link}>
              Forgot password
            </Link>{" "}
            on the sign-in page. The link we email works once, for 30 minutes.
          </>
        ),
      },
      {
        q: "How do I delete my account?",
        a: "At the bottom of the Account page. If you own a workspace, hand it to another member or delete it first.",
      },
    ],
  },
];

/** /help: short answers to what people ask most. Presentational. */
export default function HelpView() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:py-12">
      <h1 className="text-5xl leading-none font-extrabold font-stretch-70%">Help</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">Short answers to what people ask most.</p>

      <div className="mt-10 space-y-12">
        {SECTIONS.map((section) => (
          <section key={section.title} aria-labelledby={`help-${section.title}`}>
            <h2 id={`help-${section.title}`} className="text-2xl font-extrabold font-stretch-70%">
              {section.title}
            </h2>
            <dl className="mt-4 divide-y border-y">
              {section.answers.map(({ q, a }) => (
                <div key={q} className="grid gap-1 py-4 sm:grid-cols-[16rem_minmax(0,1fr)] sm:gap-8">
                  <dt className="font-semibold">{q}</dt>
                  <dd className="max-w-prose text-muted-foreground">{a}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
