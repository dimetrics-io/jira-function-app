const axios = require('axios');

const TEMPO_API_BASE_URL = 'https://api.tempo.io/4';

class TempoService {
    constructor(apiToken, jiraConfig = null) {
        this.apiToken = apiToken;
        this.jiraConfig = jiraConfig;

        this.client = axios.create({
            baseURL: TEMPO_API_BASE_URL,
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        });

        // Jira client for fetching issue keys
        if (jiraConfig) {
            const auth = Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64');
            this.jiraClient = axios.create({
                baseURL: jiraConfig.baseUrl,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                }
            });
        }
    }

    /**
     * Retrieves worklogs for a given date range
     * @param {string} startDate - Start date in YYYY-MM-DD format
     * @param {string} endDate - End date in YYYY-MM-DD format
     * @returns {Promise<Array>} Array of worklog entries
     */
    async getWorklogs(startDate, endDate) {
        const allWorklogs = [];
        let offset = 0;
        const limit = 50;
        let hasMore = true;

        while (hasMore) {
            const response = await this.client.get('/worklogs', {
                params: {
                    from: startDate,
                    to: endDate,
                    offset: offset,
                    limit: limit
                }
            });

            const { results, metadata } = response.data;

            if (results && results.length > 0) {
                allWorklogs.push(...results);
            }

            // Check if there are more results
            hasMore = metadata && metadata.next;
            offset += limit;
        }

        // Fetch issue keys from Jira if configured
        if (this.jiraClient && allWorklogs.length > 0) {
            await this.enrichWithIssueKeys(allWorklogs);
        }

        return this.transformWorklogs(allWorklogs);
    }

    /**
     * Fetches issue keys from Jira and enriches worklogs
     * @param {Array} worklogs - Raw worklog data
     */
    async enrichWithIssueKeys(worklogs) {
        // Get unique issue IDs
        const issueIds = [...new Set(worklogs.map(w => w.issue?.id).filter(Boolean))];

        if (issueIds.length === 0) return;

        // Fetch issues in batch using JQL (new API endpoint)
        const jql = `id in (${issueIds.join(',')})`;

        try {
            // Use new /rest/api/3/search/jql endpoint (POST method)
            const response = await this.jiraClient.post('/rest/api/3/search/jql', {
                jql: jql,
                fields: ['key', 'summary'],
                maxResults: issueIds.length
            });

            // Create a map of issue ID to key/summary
            const issueMap = {};
            for (const issue of response.data.issues) {
                issueMap[issue.id] = {
                    key: issue.key,
                    summary: issue.fields.summary
                };
            }

            // Enrich worklogs with issue keys
            for (const worklog of worklogs) {
                if (worklog.issue?.id && issueMap[worklog.issue.id]) {
                    worklog.issue.key = issueMap[worklog.issue.id].key;
                    worklog.issue.summary = issueMap[worklog.issue.id].summary;
                }
            }
        } catch (error) {
            console.error('Failed to fetch issue keys from Jira:', error.message);
            // Continue without issue keys rather than failing
        }
    }

    /**
     * Transforms raw Tempo worklogs into a cleaner format
     * @param {Array} worklogs - Raw worklog data from Tempo API
     * @returns {Array} Transformed worklog entries
     */
    transformWorklogs(worklogs) {
        return worklogs.map(worklog => ({
            id: worklog.tempoWorklogId,
            issueKey: worklog.issue?.key || 'N/A',
            issueId: worklog.issue?.id || null,
            issueSummary: worklog.issue?.summary || null,
            date: worklog.startDate,
            startTime: worklog.startTime || null,
            timeSpentSeconds: worklog.timeSpentSeconds,
            timeSpentHours: (worklog.timeSpentSeconds / 3600).toFixed(2),
            description: worklog.description || '',
            author: {
                accountId: worklog.author?.accountId || null,
                displayName: worklog.author?.displayName || 'Unknown'
            },
            createdAt: worklog.createdAt,
            updatedAt: worklog.updatedAt
        }));
    }
}

module.exports = TempoService;
