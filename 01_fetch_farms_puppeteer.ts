import _ from 'lodash';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { inspect } from 'util';



export const sleep = (waitTimeInMs: number) => {
    console.log('sleep started!');
    return new Promise(resolve => setTimeout(resolve, waitTimeInMs))
}



const parse = async (page: any, pool: any) => {
    const apy = await page.evaluate(
        (el: any) => parseFloat(el.innerText) / 100, 
        await pool.$('.leverage-farming-table__row-item__cell > .adjusted-apy > div > span')
    );
    const yieldLines = await pool.$$('.yield-line')
    const apr: any  = {}
    await Promise.all(
        _.map(yieldLines, async (o) => {
            const text = await page.evaluate((el: any) => el.innerText, o)
            const processedText = text.split(':\n')
            apr[
                processedText[0].trim().toLowerCase().replaceAll(' ', '_')
            ] = parseFloat(processedText[1].trim().toLowerCase()) / 100
        })
    )
    const borrows = await Promise.all(
        _.map(
            await pool.$$('.dropdown-menu > button'), 
            async o => await page.evaluate((el: any) => el.innerText, o)
        )
    )
    if (!borrows[0].endsWith('0.00%')) {
        apr.borrowing_apr = {
            [borrows[0].split('-')[0]]: (-1) * parseFloat(borrows[0].split('-')[1]) / 100,
            [borrows[1].split('-')[0]]: (-1) * parseFloat(borrows[1].split('-')[1]) / 100,
        }
    } else {
        apr.borrowing_apr = {
            [borrows[0].split('0.00%')[0]]: 0,
            [borrows[1].split('0.00%')[0]]: 0,
        }
    }

    return {
        apy,
        apr
    }
}



(async () => {
    puppeteer.use(StealthPlugin())

    const browser = await puppeteer.launch({ 
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--window-size=1920x1080',
            '--ignore-certificate-erros-spki-list',
            '--lang=en-GB',
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36'
    );
    await page.goto('https://tulip.garden/leverage');
    await sleep(10000);

    const poolSelector = '.leverage-farming-table__row-item';
    let pools = await page.$$(poolSelector);
    let processedPool = []

    for (let i = 0; i < pools.length; i++) {
        // Refresh ElementHandles to avoid "Detached from Node".
        let parsedPool: any = {}
        parsedPool['tvl'] = await page.evaluate(
            (el: any) => el.innerText.endsWith('M') ? 
                parseFloat(el.innerText.substring(1)) * 10**6
                : parseFloat(el.innerText.substring(1).replaceAll(',','')), 
            await pools[i].$('.leverage-farming-table__row-item__asset__text-tvl > span')
        );

        parsedPool['name'] = await page.evaluate(
            (el: any) => el.innerText.split('LP')[0].trim(), 
            await pools[i].$('.leverage-farming-table__row-item__asset__text-name')
        );

        parsedPool['backend'] = await page.evaluate(
            (el: any) => el.innerText, 
            await pools[i].$('.vaults-table__row-item__asset__text-tvl')
        );

        parsedPool['levels'] = []

        let leverage = await pools[i].$('.customNumberInput > input')
        let leverageDownButton = await pools[i].$('.customNumberInput-arrows__down')
        let currentLeverage = await page.evaluate(el => parseFloat(el.value), leverage)

        if (!leverageDownButton) break

        while (currentLeverage != 1.0) {
            const pool = await parse(page, pools[i])

            parsedPool['levels'].push({
                leverage: currentLeverage,
                ...pool
            })

            await leverageDownButton.click()
            currentLeverage = await page.evaluate(el => parseFloat(el.value), leverage)
        }

        const pool = await parse(page, pools[i])
        parsedPool['levels'].push({
            leverage: currentLeverage,
            ...pool
        })
        
        processedPool.push(parsedPool)
    }

    await page.close();
    await browser.close();

    console.log(inspect(processedPool, false, null, true)) // DATA VERIFICATION
})();
