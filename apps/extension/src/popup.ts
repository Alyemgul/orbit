/** The toolbar popup: connect, switch the autopilot on or off, and see what it did. */

interface State {
  connected: boolean;
  enabled: boolean;
  run: { title: string; company: string; phase: string } | null;
  log: { at: number; text: string; tone: string }[];
  status: { email: string | null; cap: number; review: boolean; applied_today: number; waiting: number; needs_you: number } | null;
  error: string | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function send<T>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

const PHASES: Record<string, string> = {
  loading: "Opening",
  submitting: "Filling",
  confirming: "Confirming",
  waiting_user: "Waiting for you",
};

function render(state: State): void {
  $("connect").hidden = state.connected;
  $("connected").hidden = !state.connected;
  $("dot").classList.toggle("on", state.connected && state.enabled);
  if (!state.connected) return;

  $<HTMLInputElement>("toggle").checked = state.enabled;
  const status = state.status;
  $("account").textContent = status
    ? `${status.email ?? ""}${status.review ? " · review before send" : ""}`
    : "Not reachable";
  $("applied").textContent = String(status?.applied_today ?? 0);
  $("cap").textContent = `of ${status?.cap ?? 15} today`;
  $("waiting").textContent = String(status?.waiting ?? 0);
  $("needs").textContent = String(status?.needs_you ?? 0);

  const errorBox = $("status-error");
  errorBox.hidden = !state.error;
  errorBox.textContent = state.error ?? "";

  const run = $("run");
  run.hidden = !state.run;
  if (state.run) run.textContent = `${PHASES[state.run.phase] ?? state.run.phase}: ${state.run.title || state.run.company}${state.run.title ? ` at ${state.run.company}` : ""}`;

  const list = $("log");
  list.replaceChildren(
    ...state.log.slice(0, 20).map((entry) => {
      const li = document.createElement("li");
      const time = document.createElement("time");
      time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const text = document.createElement("span");
      text.className = entry.tone;
      text.textContent = entry.text;
      li.append(time, text);
      return li;
    }),
  );
  if (!state.log.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Nothing yet.";
    list.append(li);
  }
}

async function refresh(): Promise<void> {
  render(await send<State>({ type: "popup:state" }));
}

$("connect-btn").addEventListener("click", async () => {
  const code = $<HTMLTextAreaElement>("code").value.trim();
  const result = await send<State & { error?: string }>({ type: "popup:connect", code });
  const box = $("connect-error");
  if ("connected" in result && result.connected) {
    box.hidden = true;
    render(result);
  } else {
    box.hidden = false;
    box.textContent = result.error ?? "Couldn't connect.";
  }
});

$<HTMLInputElement>("toggle").addEventListener("change", async (event) => {
  render(await send<State>({ type: "popup:toggle", enabled: (event.target as HTMLInputElement).checked }));
});

$("run-btn").addEventListener("click", async () => {
  render(await send<State>({ type: "popup:run-now" }));
  setTimeout(() => void refresh(), 2500);
});

$("disconnect-btn").addEventListener("click", async () => {
  if (confirm("Disconnect this browser from Orbit?")) render(await send<State>({ type: "popup:disconnect" }));
});

$("fill-btn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const box = $("fill-result");
  box.hidden = false;
  if (!tab?.id || !tab.url) {
    box.textContent = "Open a Greenhouse, Lever or Ashby application first.";
    return;
  }
  box.textContent = "Filling…";
  const result = await send<{ message: string }>({ type: "popup:fill-here", tabId: tab.id, url: tab.url });
  box.textContent = result.message;
});

void refresh();
