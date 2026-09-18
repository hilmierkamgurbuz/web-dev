export const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export const SOURCE_EXT = /\.(m|c)?[jt]sx?$|\.(vue|svelte|astro|css|scss|sass|less|html?|sql|prisma|graphql|gql)$|(^|[\\/])package\.json$/i;

export const POWERSHELL_WRITE = /\b(Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item|Rename-Item|Clear-Content|Set-ItemProperty|Export-Csv|Export-Clixml|Tee-Object)\b|\[(System\.)?IO\.File\]::(Write|Append|Create|Delete|Move|Copy)|\bOut-File\b|>>?\s*\S/i;
