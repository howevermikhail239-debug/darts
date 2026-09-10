import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLastSetupTemplate,
  lastSetupContext,
  type LastSetupRepository,
  type LastSetupTemplate,
} from "../../application/LastSetup";
import type { MatchParticipantInput } from "../../application/StartMatch";
import type { MatchSetup } from "../../domain/match/createMatch";

export function useLastSetup(repository: LastSetupRepository, companyToken?: string) {
  const context = lastSetupContext(companyToken);
  const generation = useRef(0);
  const [state, setState] = useState<Readonly<{ context: string; ready: boolean; template?: LastSetupTemplate }>>({
    context,
    ready: false,
  });
  const loading = state.context !== context || !state.ready;

  useEffect(() => {
    const expected = ++generation.current;
    void repository.load(context).then((template) => {
      if (generation.current === expected) setState({ context, ready: true, ...(template ? { template } : {}) });
    }).catch(() => {
      if (generation.current === expected) setState({ context, ready: true });
    });
  }, [context, repository]);

  const remember = useCallback(async (participants: readonly MatchParticipantInput[], setup: MatchSetup) => {
    const template = createLastSetupTemplate(participants, setup);
    await repository.save(context, template);
    if (context === lastSetupContext(companyToken)) setState({ context, ready: true, template });
  }, [companyToken, context, repository]);

  return { loading, template: state.context === context ? state.template : undefined, remember, context };
}
