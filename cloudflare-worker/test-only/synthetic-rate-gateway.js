// Build-only test entrypoint. It is not part of the production Worker.
// Its destination is deliberately unprovisioned and its service is disabled.
import {createRateSyntheticPortalGateway} from '../src/synthetic-portal-gateway.js';
export default createRateSyntheticPortalGateway();
