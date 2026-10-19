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
        a: "Joining a workspace puts you in its General club. Other clubs you join through their own invite links; some ask an organiser to approve you first.",
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
        q: "Can an event repeat?",
        a: "Yes. In New event, choose Repeats (every week, fortnight or month) and how many times. Each one is its own event, with its own places and tickets. When you edit, cancel, publish or delete one, you can choose just that one or it and every later one.",
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
    ],
  },
  {
    title: "Your account",
    answers: [
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
