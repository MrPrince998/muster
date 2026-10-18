/** Buttons on this page match the 44px inputs beside them. */
export const actionSize = "h-11 px-4 text-[15px] font-semibold";

/** One block of the account page: a heading (with an optional action beside it), a line on why, the controls. */
export function AccountRow({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="border-t py-9 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2
            id={id}
            className="text-2xl leading-tight font-extrabold font-stretch-70%"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
