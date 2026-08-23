import { NodeRuntime } from "@effect/platform-node";
import { Effect, Either } from "effect";
import { isDemoDeployment } from "../../runtime/deployment";
import { provisionAdmin, ProvisionLayer } from "./admin";
import { parse, USAGE } from "./options";

/**
 * The `npm run provision:admin` entry point, and nothing else.
 *
 * The program lives next door so a test can run it, for the reason
 * `seed/run.ts` gives: a module that calls `runMain` at import time cannot be
 * imported by anything, including the test that would prove it works.
 *
 * What is here rather than there is everything that needs a terminal — the
 * arguments and the password — because none of it can be exercised without
 * one.
 */

/**
 * Asks for the password without putting it on the screen.
 *
 * Raw mode, reading a byte at a time, because there is no way to un-echo a
 * character once the line discipline has printed it. The alternative offered by
 * `readline` is to overwrite its own output, which works and still means the
 * password was on the screen for a frame — and this may be typed in an office
 * with somebody standing behind the person doing it.
 *
 * `ADMIN_PASSWORD` is the escape hatch for a session with no terminal to ask
 * on. It is second, and documented as second, because an environment variable
 * is visible to `ps` for the life of the process and lands in shell history
 * forever.
 */
const askForPassword = (prompt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const { stdin, stdout } = process;

    if (!stdin.isTTY) {
      reject(
        new Error(
          "There is no terminal to ask for a password on. Set ADMIN_PASSWORD " +
            "for this one command if you must run it unattended.",
        ),
      );
      return;
    }

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let typed = "";

    const done = (finish: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      finish();
    };

    const onData = (chunk: string) => {
      for (const character of chunk) {
        switch (character) {
          case "\r":
          case "\n":
            done(() => resolve(typed));
            return;
          /**
           * Ctrl-C. Raw mode turns off the terminal's own handling of it, so
           * without this the process cannot be interrupted at the one prompt
           * somebody is most likely to want to back out of.
           */
          case "\u0003":
            done(() => reject(new Error("Cancelled.")));
            return;
          /** Delete and backspace; terminals disagree about which they send. */
          case "\u007f":
          case "\b":
            typed = typed.slice(0, -1);
            break;
          default:
            typed += character;
        }
      }
    };

    stdin.on("data", onData);
  });

const password = async (): Promise<string> => {
  const fromEnvironment = process.env["ADMIN_PASSWORD"];

  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    return fromEnvironment;
  }

  const chosen = await askForPassword("Password for the new account: ");
  const again = await askForPassword("And again: ");

  if (chosen !== again) {
    throw new Error(
      "Those did not match. Nothing has been written; run it again.",
    );
  }

  return chosen;
};

const program = Effect.gen(function* () {
  const request = parse(process.argv.slice(2));

  if (Either.isLeft(request)) {
    yield* Effect.logError(request.left);
    return yield* Effect.fail(new Error(USAGE));
  }

  /**
   * A warning rather than a refusal.
   *
   * Creating a real account on the demonstration is a legitimate thing to do —
   * it is how you would test this program before pointing it at a firm — and
   * it is also completely futile if nobody says so, because the nightly reset
   * wipes `users` and the account is gone by morning. So it says so, and
   * carries on.
   */
  if (yield* Effect.promise(isDemoDeployment)) {
    yield* Effect.logWarning(
      "This deployment is the demonstration: it wipes and re-seeds every " +
        "night, and this account will be gone with it.",
    );
  }

  const chosen = yield* Effect.tryPromise({
    try: password,
    catch: (failure) =>
      failure instanceof Error ? failure : new Error(String(failure)),
  });

  const provisioned = yield* provisionAdmin(request.right, chosen);

  yield* Effect.logInfo(
    `Done. ${provisioned.email} is ${provisioned.role}, user ${provisioned.userId}.`,
  );
}).pipe(Effect.provide(ProvisionLayer));

NodeRuntime.runMain(program);
