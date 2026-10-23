export async function clickNavigation(page,name){
 const button=page.locator('aside.sidebar').getByRole('button',{name,exact:true,includeHidden:true});
 if(!await button.isVisible())await button.locator('xpath=ancestor::details').locator('summary').click();
 await button.click();
}
