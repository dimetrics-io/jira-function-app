const TempoService = require('./tempoService');

/**
 * Azure Function HTTP Trigger for retrieving Tempo worklogs
 *
 * Query Parameters:
 * - startDate: Start date in YYYY-MM-DD format (required)
 * - endDate: End date in YYYY-MM-DD format (required)
 *
 * Example: GET /api/worklogs?startDate=2026-01-01&endDate=2026-01-31
 */
module.exports = async function (context, req) {
    context.log('GetWorklogs function triggered');

    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const format = req.query.format; // 'flat' returns array only (for Synapse/ADF)

    // Validate required parameters
    if (!startDate || !endDate) {
        context.res = {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: {
                error: 'Missing required parameters',
                message: 'Both startDate and endDate query parameters are required (format: YYYY-MM-DD)',
                example: '/api/worklogs?startDate=2026-01-01&endDate=2026-01-31'
            }
        };
        return;
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        context.res = {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: {
                error: 'Invalid date format',
                message: 'Dates must be in YYYY-MM-DD format',
                provided: { startDate, endDate }
            }
        };
        return;
    }

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
        context.res = {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: {
                error: 'Invalid date range',
                message: 'startDate must be before or equal to endDate'
            }
        };
        return;
    }

    // Get API tokens from environment
    const tempoApiToken = process.env.TEMPO_API_TOKEN;
    if (!tempoApiToken) {
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: {
                error: 'Configuration error',
                message: 'TEMPO_API_TOKEN is not configured'
            }
        };
        return;
    }

    // Jira config for enriching worklogs with issue keys
    const jiraConfig = process.env.JIRA_API_TOKEN ? {
        apiToken: process.env.JIRA_API_TOKEN,
        email: process.env.JIRA_EMAIL,
        baseUrl: process.env.JIRA_BASE_URL
    } : null;

    try {
        const tempoService = new TempoService(tempoApiToken, jiraConfig);
        const worklogs = await tempoService.getWorklogs(startDate, endDate);

        // Calculate summary
        const totalSeconds = worklogs.reduce((sum, w) => sum + w.timeSpentSeconds, 0);
        const totalHours = (totalSeconds / 3600).toFixed(2);

        // Flat format: return array only (for Synapse/ADF Copy Activity)
        if (format === 'flat') {
            context.res = {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: worklogs
            };
            return;
        }

        // Default: return full response with metadata
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: {
                success: true,
                query: {
                    startDate,
                    endDate
                },
                summary: {
                    totalWorklogs: worklogs.length,
                    totalHours: parseFloat(totalHours),
                    totalSeconds: totalSeconds
                },
                worklogs: worklogs
            }
        };

    } catch (error) {
        context.log.error('Error fetching worklogs:', error.message);

        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.message || error.message;

        context.res = {
            status: statusCode,
            headers: { 'Content-Type': 'application/json' },
            body: {
                error: 'Failed to retrieve worklogs',
                message: errorMessage,
                details: error.response?.data || null
            }
        };
    }
};
