import Link from "next/link";

export function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mb-4 text-6xl">🔒</div>
        <h1 className="mb-2 text-2xl font-bold text-[#2D2926]">
          Access Denied
        </h1>
        <p className="mb-6 text-gray-600">
          You don&apos;t have permission to access the Widget Demo Library.
          Contact your administrator to request access.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md bg-[#004C97] px-4 py-2 text-sm font-medium text-white hover:bg-[#002855]"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
