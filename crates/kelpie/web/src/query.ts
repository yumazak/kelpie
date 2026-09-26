import { QueryClient } from "@tanstack/react-query";

/**
 * The app's one cache. The session list, a conversation's messages, and the
 * pending permissions/forms all live here, and the event stream writes into it
 * rather than into component state.
 */
export const queryClient = new QueryClient();
